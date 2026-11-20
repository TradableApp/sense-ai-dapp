import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readContract } from 'thirdweb';
import { useActiveWalletChain } from 'thirdweb/react';
import { eth_getCode as getCodeAt, getRpcClient } from 'thirdweb/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';

import useFeeTokenCheck, { FEE_TOKEN_RECHECK_MS, forgetReportedFailures } from './useFeeTokenCheck';

const CHAIN_ID = 84532;
const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const ESCROW = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TREASURY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const AGENT = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const OTHER_AGENT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const DEPLOYED = '0x6080604052348015600e575f5ffd5b50';
/** A chain the build has a token and an escrow for, but no agent. */
const CHAIN_WITHOUT_AGENT = 31337;

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({
	getContract: vi.fn(({ address }: { address: string }) => ({ address })),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => ({ useActiveWalletChain: vi.fn() }));
vi.mock('thirdweb/rpc', () => ({
	getRpcClient: vi.fn(() => 'rpc-request'),
	eth_getCode: vi.fn(),
}));
vi.mock('@/config/feeToken', () => ({
	FEE_TOKEN: { symbol: 'PTS', transferable: false, pausable: true },
}));
vi.mock('@/config/contracts', () => {
	const fn = (name: string) => ({ type: 'function', name });
	const token = {
		address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
		abi: [fn('symbol'), fn('paused'), fn('isTransferExempt')],
	};
	const escrow = {
		address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
		abi: [fn('ableToken'), fn('evmAIAgent'), fn('treasury')],
	};
	return {
		CONTRACTS: {
			84532: {
				token,
				escrow,
				agent: { address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', abi: [] },
			},
			31337: { token, escrow, agent: { address: undefined, abi: [] } },
		},
	};
});

type Call = { contract: { address: string }; method: { name: string }; params: string[] };

function chainAnswers(over: Record<string, unknown> = {}) {
	vi.mocked(readContract).mockImplementation((async (call: Call) => {
		const key =
			call.method.name === 'isTransferExempt' ? `exempt:${call.params[0]}` : call.method.name;
		const answers: Record<string, unknown> = {
			[ESCROW_FEE_TOKEN_GETTER]: TOKEN,
			evmAIAgent: AGENT,
			treasury: TREASURY,
			symbol: 'PTS',
			paused: false,
			[`exempt:${ESCROW}`]: true,
			[`exempt:${TREASURY}`]: true,
			...over,
		};
		const answer = answers[key];
		if (answer instanceof Error) throw answer;
		return answer;
	}) as unknown as typeof readContract);
	vi.mocked(getCodeAt).mockImplementation((async (
		_rpc: unknown,
		{ address }: { address: string },
	) => {
		const answer = over[`code:${address}`] ?? DEPLOYED;
		if (answer instanceof Error) throw answer;
		return answer;
	}) as unknown as typeof getCodeAt);
}

function harness() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return { queryClient, ...renderHook(() => useFeeTokenCheck(), { wrapper }) };
}

const refetch = (queryClient: QueryClient) =>
	act(async () => {
		await queryClient.refetchQueries({ queryKey: ['feeTokenCheck'] });
	});

const onChain = (id: number) =>
	vi
		.mocked(useActiveWalletChain)
		.mockReturnValue({ id } as ReturnType<typeof useActiveWalletChain>);

describe('useFeeTokenCheck', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		forgetReportedFailures();
		onChain(CHAIN_ID);
	});
	afterEach(cleanup);

	it('passes when the chain agrees with the build', async () => {
		chainAnswers();
		const { result } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('ok'));
		expect(result.current.blocks('prompt')).toBe(false);
	});

	it('asks the chain with the function each ABI declares', async () => {
		chainAnswers();
		const { result } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('ok'));
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({
				contract: { address: TOKEN },
				method: expect.objectContaining({ type: 'function', name: 'isTransferExempt' }),
				params: [ESCROW],
			}),
		);
	});

	it('stops payments when the escrow is not listed on the token', async () => {
		chainAnswers({ [`exempt:${ESCROW}`]: false });
		const { result } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('escrow-not-exempt'));
		expect(result.current.blocks('prompt')).toBe(true);
	});

	it('stops every paying action when the escrow serves another agent', async () => {
		chainAnswers({ evmAIAgent: OTHER_AGENT });

		const { result } = harness();

		await waitFor(() => expect(result.current.verdict).toBe('escrow-serves-other-agent'));
		expect(result.current.blocks('prompt')).toBe(true);
		expect(result.current.blocks('plan')).toBe(true);
	});

	it('reads nothing when the build has no agent for the chain', () => {
		onChain(CHAIN_WITHOUT_AGENT);
		chainAnswers();

		const { result } = harness();

		expect(result.current.verdict).toBe('unknown');
		expect(readContract).not.toHaveBeenCalled();
	});

	it('stops every paying action when there is no contract at the escrow address', async () => {
		chainAnswers({ [`code:${ESCROW}`]: '0x' });

		const { result } = harness();

		await waitFor(() => expect(result.current.verdict).toBe('contract-not-found'));
		expect(result.current.blocks('prompt')).toBe(true);
		expect(readContract).not.toHaveBeenCalled();
	});

	it('asks the node itself for the code at the escrow and the token', async () => {
		chainAnswers();

		const { result } = harness();

		await waitFor(() => expect(result.current.verdict).toBe('ok'));
		expect(getRpcClient).toHaveBeenCalledWith(
			expect.objectContaining({ chain: expect.objectContaining({ id: CHAIN_ID }) }),
		);
		expect(getCodeAt).toHaveBeenCalledWith('rpc-request', { address: ESCROW });
		expect(getCodeAt).toHaveBeenCalledWith('rpc-request', { address: TOKEN });
	});

	it('does not stop payments when the code read fails', async () => {
		chainAnswers({ [`code:${ESCROW}`]: new Error('fetch failed') });

		const { result } = harness();

		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		expect(result.current.verdict).toBe('unknown');
		expect(result.current.blocks('prompt')).toBe(false);
	});

	it('stops every paying action while the token is paused', async () => {
		chainAnswers({ paused: true });

		const { result } = harness();

		await waitFor(() => expect(result.current.verdict).toBe('token-paused'));
		expect(result.current.blocks('prompt')).toBe(true);
		expect(result.current.blocks('metadata')).toBe(true);
	});

	it('stops only direct fees when the treasury is not listed', async () => {
		chainAnswers({ [`exempt:${TREASURY}`]: false });
		const { result } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('treasury-not-exempt'));
		expect(result.current.blocks('prompt')).toBe(false);
		expect(result.current.blocks('branch')).toBe(true);
	});

	it('does not stop payments when the first read fails, and reports the failure', async () => {
		chainAnswers({
			treasury: new Error('RPC request failed with status 429 - Too Many Requests: slow down'),
		});
		const { result } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		expect(result.current.verdict).toBe('unknown');
		expect(result.current.blocks('prompt')).toBe(false);
		expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
			tags: { check: 'fee-token', failure: 'rpc' },
			fingerprint: ['fee-token-check', 'rpc'],
		});
	});

	it('keeps a confirmed block when a later read fails', async () => {
		chainAnswers({ [`exempt:${ESCROW}`]: false });
		const { result, queryClient } = harness();
		await waitFor(() => expect(result.current.blocks('prompt')).toBe(true));

		chainAnswers({ treasury: new Error('later read: connection lost') });
		await refetch(queryClient);
		// The failed read did happen: without this the test would pass on a read never made.
		await waitFor(() =>
			expect(
				queryClient.getQueryCache().findAll({ queryKey: ['feeTokenCheck'] })[0].state.error,
			).toBeTruthy(),
		);

		expect(result.current.verdict).toBe('escrow-not-exempt');
		expect(result.current.blocks('prompt')).toBe(true);
	});

	it('lifts the block when a later read passes', async () => {
		chainAnswers({ [`exempt:${ESCROW}`]: false });
		const { result, queryClient } = harness();
		await waitFor(() => expect(result.current.blocks('prompt')).toBe(true));

		chainAnswers();
		await refetch(queryClient);

		await waitFor(() => expect(result.current.verdict).toBe('ok'));
	});

	it('reports the same failure once, however often the read is repeated', async () => {
		chainAnswers({ treasury: new Error('repeated: node unreachable') });
		const { queryClient } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		await refetch(queryClient);
		await refetch(queryClient);
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it('never sends the original error, only its kind and a scrubbed first line', async () => {
		const original = new Error(
			`RPC Error from https://84532.rpc.example/s3cret-key:\nrequests: [{"data":"${TREASURY}"}]`,
		);
		chainAnswers({ treasury: original });

		harness();

		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		const [sent, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(sent).not.toBe(original);
		expect((sent as Error).message).toBe('rpc: RPC Error from <url>');
		expect(JSON.stringify([String(sent), context])).not.toMatch(/s3cret|requests|70997970/i);
	});

	it('reports failures of a different kind apart', async () => {
		chainAnswers({ treasury: new TypeError('Failed to fetch') });
		const { queryClient } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		chainAnswers({ treasury: new Error('Cannot decode zero data ("0x") with ABI parameters.') });

		await refetch(queryClient);

		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(2));
		const fingerprints = vi
			.mocked(Sentry.captureException)
			.mock.calls.map(([, context]) => (context as { fingerprint: string[] }).fingerprint);
		expect(fingerprints).toEqual([
			['fee-token-check', 'node'],
			['fee-token-check', 'zero-data'],
		]);
	});

	it('reports a failure once when only the batch it came in differs', async () => {
		chainAnswers({ treasury: new Error('RPC Error from https://a.example/1:\nrequests: [1]') });
		const { queryClient } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		chainAnswers({ treasury: new Error('RPC Error from https://b.example/2:\nrequests: [2]') });

		await refetch(queryClient);

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it('reports a kind of failure once per page load, even when its first line changes each time', async () => {
		chainAnswers({
			treasury: new Error('RPC request failed with status 500 - Internal: request id 7f1'),
		});
		const { queryClient } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		chainAnswers({
			treasury: new Error('RPC request failed with status 500 - Internal: request id 9c4'),
		});

		await refetch(queryClient);

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it('reports a failure again after a new page load, even with the same words', async () => {
		chainAnswers({ treasury: new Error('same words') });
		harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		cleanup();

		forgetReportedFailures();
		harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(2));
	});

	it('reads nothing on a chain the build has no contracts for', () => {
		onChain(1);
		const { result } = harness();
		expect(result.current.verdict).toBe('unknown');
		expect(readContract).not.toHaveBeenCalled();
	});

	it('follows the wallet to another configured chain', async () => {
		chainAnswers();
		const { result, rerender } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('ok'));

		onChain(1);
		rerender();
		expect(result.current.verdict).toBe('unknown');
	});

	it('reads nothing with no wallet connected', () => {
		vi.mocked(useActiveWalletChain).mockReturnValue(undefined);
		const { result } = harness();
		expect(result.current.verdict).toBe('unknown');
		expect(readContract).not.toHaveBeenCalled();
	});
});

describe('the five-minute recheck', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		forgetReportedFailures();
		onChain(CHAIN_ID);
		// Only the recheck's interval is faked; vi.waitFor keeps its own real timers.
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	const fiveMinutesPass = () =>
		act(() => {
			vi.advanceTimersByTime(FEE_TOKEN_RECHECK_MS);
		});

	it('asks again every five minutes', () => {
		expect(FEE_TOKEN_RECHECK_MS).toBe(5 * 60 * 1000);
	});

	it('notices an escrow unlisted after the page loaded, with nothing else happening', async () => {
		chainAnswers();
		const { result } = harness();
		await vi.waitFor(() => expect(result.current.verdict).toBe('ok'));
		chainAnswers({ [`exempt:${ESCROW}`]: false });

		await fiveMinutesPass();

		await vi.waitFor(() => expect(result.current.verdict).toBe('escrow-not-exempt'));
		expect(result.current.blocks('prompt')).toBe(true);
	});

	it('lifts a block once the escrow is listed again, with nothing else happening', async () => {
		chainAnswers({ [`exempt:${ESCROW}`]: false });
		const { result } = harness();
		await vi.waitFor(() => expect(result.current.verdict).toBe('escrow-not-exempt'));
		chainAnswers();

		await fiveMinutesPass();

		await vi.waitFor(() => expect(result.current.verdict).toBe('ok'));
		expect(result.current.blocks('prompt')).toBe(false);
	});
});
