import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createStatePoller,
	deriveInvalidations,
	ESCROW_PROBE_METHODS,
	type EscrowSnapshot,
	LIVE_POLL_INTERVAL_MS,
	LIVE_POLL_JITTER_RATIO,
	LIVE_POLL_MAX_BACKOFF_MS,
	serializeSnapshot,
	type StatePollerDeps,
} from '@/hooks/liveStateProbe';
import escrowAbiJson from '@/lib/abi/EVMAIAgentEscrow.json';

// User journey: as a user with the dashboard open, I want the app to notice my on-chain
// activity (a prompt answered, a prompt submitted from my phone, a limit changed) within
// one block — without flooding the public RPC with log queries, without a 429 storm when
// the endpoint pushes back, and without burning requests while the tab is in the background.

const snap = (overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot => ({
	pendingEscrowCount: 0n,
	allowance: 100n,
	spentAmount: 10n,
	expiresAt: 1_800_000_000n,
	...overrides,
});

function makePoller(overrides: Partial<StatePollerDeps> = {}) {
	const deps = {
		read: vi.fn<() => Promise<EscrowSnapshot>>().mockResolvedValue(snap()),
		onChange: vi.fn<StatePollerDeps['onChange']>(),
		report: vi.fn<StatePollerDeps['report']>(),
		isHidden: () => false,
		random: () => 0,
		...overrides,
	};
	return { deps, poller: createStatePoller(deps) };
}

// Flush pending microtasks so an awaited `read()` settles inside a fake-timer test.
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

describe('ESCROW_PROBE_METHODS', () => {
	// Coupling test: the literals the poller reads with must match the synced ABI, so a
	// contract change that renames or reshapes either getter fails here, not in production.
	interface AbiParam {
		name: string;
		type: string;
	}
	interface AbiItem {
		type: string;
		name?: string;
		stateMutability?: string;
		inputs?: AbiParam[];
		outputs?: AbiParam[];
	}
	const signatureOf = (name: string) => {
		const item = (escrowAbiJson.abi as AbiItem[]).find(
			entry => entry.type === 'function' && entry.name === name,
		);
		if (!item) throw new Error(`ABI has no function ${name}`);
		const inputs = (item.inputs ?? []).map(i => i.type).join(',');
		const outputs = (item.outputs ?? [])
			.map(o => (o.name ? `${o.type} ${o.name}` : o.type))
			.join(', ');
		return `function ${name}(${inputs}) ${item.stateMutability} returns (${outputs})`;
	};

	it('matches the synced EVMAIAgentEscrow ABI', () => {
		expect(ESCROW_PROBE_METHODS.spendingLimits).toBe(signatureOf('spendingLimits'));
		expect(ESCROW_PROBE_METHODS.pendingEscrowCount).toBe(signatureOf('pendingEscrowCount'));
	});
});

describe('serializeSnapshot', () => {
	it('is stable for equal snapshots and differs when any field changes', () => {
		const a = snap();
		expect(serializeSnapshot(a)).toBe(serializeSnapshot(snap()));
		expect(serializeSnapshot(a)).not.toBe(serializeSnapshot(snap({ pendingEscrowCount: 1n })));
		expect(serializeSnapshot(a)).not.toBe(serializeSnapshot(snap({ spentAmount: 11n })));
		expect(serializeSnapshot(a)).not.toBe(serializeSnapshot(snap({ expiresAt: 0n })));
	});
});

describe('createStatePoller', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('probes immediately on start and treats the first read as the baseline, not a change', async () => {
		const { deps, poller } = makePoller();

		poller.start();
		await flush();

		expect(deps.read).toHaveBeenCalledTimes(1);
		expect(deps.onChange).not.toHaveBeenCalled();
		poller.stop();
	});

	it('polls once per block interval while nothing changes, calling onChange never', async () => {
		const { deps, poller } = makePoller();

		poller.start();
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 3);

		expect(deps.read).toHaveBeenCalledTimes(4);
		expect(deps.onChange).not.toHaveBeenCalled();
		poller.stop();
	});

	it('reports a change once with the previous and next snapshots', async () => {
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockResolvedValueOnce(snap({ pendingEscrowCount: 1n, spentAmount: 15n }))
			.mockResolvedValue(snap({ pendingEscrowCount: 1n, spentAmount: 15n }));
		const { deps, poller } = makePoller({ read });

		poller.start();
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 2);

		expect(deps.onChange).toHaveBeenCalledTimes(1);
		expect(deps.onChange).toHaveBeenCalledWith({
			prev: snap(),
			next: snap({ pendingEscrowCount: 1n, spentAmount: 15n }),
		});
		poller.stop();
	});

	it('backs off exponentially on failure, reports a breadcrumb each time, and never rejects', async () => {
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockRejectedValueOnce(new Error('RPC request failed with status 429'))
			.mockRejectedValueOnce(new Error('RPC request failed with status 429'))
			.mockResolvedValue(snap());
		const { deps, poller } = makePoller({ read });

		poller.start();
		await flush(); // baseline
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // 1st failure
		expect(deps.read).toHaveBeenCalledTimes(2);
		expect(deps.report).toHaveBeenLastCalledWith(
			'live poll: read failed, backing off',
			expect.objectContaining({ attempt: 1, nextDelayMs: LIVE_POLL_INTERVAL_MS * 2 }),
		);

		// Not yet: the base interval has elapsed but the backoff has not.
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
		expect(deps.read).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // 2nd failure at 4 s
		expect(deps.read).toHaveBeenCalledTimes(3);
		expect(deps.report).toHaveBeenLastCalledWith(
			'live poll: read failed, backing off',
			expect.objectContaining({ attempt: 2, nextDelayMs: LIVE_POLL_INTERVAL_MS * 4 }),
		);

		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 4); // recovery
		expect(deps.read).toHaveBeenCalledTimes(4);
		expect(deps.report).toHaveBeenLastCalledWith(
			'live poll: recovered',
			expect.objectContaining({ failures: 2 }),
		);
		// Recovery does not count as a change.
		expect(deps.onChange).not.toHaveBeenCalled();
		poller.stop();
	});

	it('resets to the base interval after recovery', async () => {
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue(snap());
		const { deps, poller } = makePoller({ read });

		poller.start();
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // failure → 4 s backoff
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 2); // recovery read
		expect(deps.read).toHaveBeenCalledTimes(3);

		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // back on the 2 s cadence
		expect(deps.read).toHaveBeenCalledTimes(4);
		poller.stop();
	});

	it('caps the backoff and adds bounded jitter', async () => {
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockRejectedValue(new Error('down'));
		const report = vi.fn<StatePollerDeps['report']>();
		const { poller } = makePoller({ read, random: () => 1, report });

		poller.start();
		await flush();
		// Walk the failures until the delay stops growing.
		for (let i = 0; i < 8; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			await vi.advanceTimersByTimeAsync(LIVE_POLL_MAX_BACKOFF_MS * (1 + LIVE_POLL_JITTER_RATIO));
		}
		const delays = report.mock.calls
			.filter(([message]) => message === 'live poll: read failed, backing off')
			.map(([, data]) => data.nextDelayMs as number);

		expect(delays.length).toBeGreaterThanOrEqual(6);
		expect(Math.max(...delays)).toBeLessThanOrEqual(
			LIVE_POLL_MAX_BACKOFF_MS * (1 + LIVE_POLL_JITTER_RATIO),
		);
		expect(Math.max(...delays)).toBeGreaterThan(LIVE_POLL_MAX_BACKOFF_MS);
		poller.stop();
	});

	it('does not read while the tab is hidden, and probes immediately on wake', async () => {
		let hidden = false;
		const { deps, poller } = makePoller({ isHidden: () => hidden });

		poller.start();
		await flush();
		hidden = true;
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 5);
		expect(deps.read).toHaveBeenCalledTimes(1);

		hidden = false;
		poller.wake();
		await flush();
		expect(deps.read).toHaveBeenCalledTimes(2);

		// And the cadence resumes after the wake probe.
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
		expect(deps.read).toHaveBeenCalledTimes(3);
		poller.stop();
	});

	it('wake while visible and idle does not double-probe inside the same interval', async () => {
		const { deps, poller } = makePoller();

		poller.start();
		await flush();
		poller.wake();
		await flush();

		expect(deps.read).toHaveBeenCalledTimes(1);
		poller.stop();
	});

	it('reports a throwing change handler without backing off or replaying the change', async () => {
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockResolvedValue(snap({ pendingEscrowCount: 1n }));
		const onChange = vi.fn<StatePollerDeps['onChange']>().mockImplementationOnce(() => {
			throw new Error('invalidate blew up');
		});
		const { deps, poller } = makePoller({ read, onChange });

		poller.start();
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // change → handler throws
		expect(deps.report).toHaveBeenLastCalledWith(
			'live poll: change handler failed',
			expect.objectContaining({ reason: 'invalidate blew up' }),
		);

		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // same snapshot again
		expect(deps.read).toHaveBeenCalledTimes(3); // no backoff: still on the 2 s cadence
		expect(onChange).toHaveBeenCalledTimes(1); // baseline advanced; not replayed
		poller.stop();
	});

	it('stop cancels the next tick and ignores an in-flight result', async () => {
		let resolveRead: ((_s: EscrowSnapshot) => void) | undefined;
		const read = vi
			.fn<() => Promise<EscrowSnapshot>>()
			.mockResolvedValueOnce(snap())
			.mockImplementationOnce(
				() =>
					new Promise<EscrowSnapshot>(resolve => {
						resolveRead = resolve;
					}),
			);
		const { deps, poller } = makePoller({ read });

		poller.start();
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS); // in-flight now
		poller.stop();
		resolveRead?.(snap({ pendingEscrowCount: 5n }));
		await flush();
		await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 3);

		expect(deps.onChange).not.toHaveBeenCalled();
		expect(deps.read).toHaveBeenCalledTimes(2);
	});
});

describe('deriveInvalidations', () => {
	const tokenBalanceKey = ['walletBalance', 84532, '0xabc', { tokenAddress: '0xtoken' }];
	const ctx = { tokenBalanceKey, ownerAddress: '0xabc', activeConversationId: '7' };

	it('refreshes plan, balance, activity, conversations and the active chat when a paid action starts', () => {
		const keys = deriveInvalidations(
			snap(),
			snap({ pendingEscrowCount: 1n, spentAmount: 15n }),
			ctx,
		);

		expect(keys).toEqual(
			expect.arrayContaining([
				['usagePlan'],
				tokenBalanceKey,
				['recentActivity'],
				['conversations'],
				['messages', '7', '0xabc'],
			]),
		);
		expect(keys).not.toContainEqual(['stuckRequests']);
	});

	it('also refreshes stuck requests when a pending action resolves (answer, cancel, refund)', () => {
		const keys = deriveInvalidations(
			snap({ pendingEscrowCount: 2n }),
			snap({ pendingEscrowCount: 1n }),
			ctx,
		);

		expect(keys).toContainEqual(['stuckRequests']);
		expect(keys).toContainEqual(['messages', '7', '0xabc']);
		expect(keys).toContainEqual(['conversations']);
	});

	it('refreshes the conversation list and active chat on a direct payment (branch, rename) that leaves the count unchanged', () => {
		// Branch and metadata-update fees are paid directly: spentAmount rises but
		// pendingEscrowCount does not, and the oracle's fulfilment touches no escrow state.
		const keys = deriveInvalidations(snap(), snap({ spentAmount: 12n }), ctx);

		expect(keys).toEqual(
			expect.arrayContaining([
				['usagePlan'],
				tokenBalanceKey,
				['recentActivity'],
				['conversations'],
				['messages', '7', '0xabc'],
			]),
		);
		expect(keys).not.toContainEqual(['stuckRequests']);
	});

	it('refreshes the same set when only the spending limit changes (indistinguishable from a direct payment)', () => {
		const keys = deriveInvalidations(
			snap(),
			snap({ allowance: 500n, expiresAt: 1_900_000_000n }),
			ctx,
		);

		expect(keys).toEqual(
			expect.arrayContaining([
				['usagePlan'],
				['recentActivity'],
				tokenBalanceKey,
				['conversations'],
			]),
		);
		expect(keys).not.toContainEqual(['stuckRequests']);
	});

	it('omits the messages key when no conversation is open', () => {
		const keys = deriveInvalidations(snap(), snap({ pendingEscrowCount: 1n }), {
			...ctx,
			activeConversationId: null,
		});

		expect(keys.some(k => k[0] === 'messages')).toBe(false);
	});

	it('returns nothing for identical snapshots', () => {
		expect(deriveInvalidations(snap(), snap(), ctx)).toEqual([]);
	});
});
