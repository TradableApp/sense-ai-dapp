import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall, readContract } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import { blocksAction, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { type PromptsSwitchState, SWITCH_WORDINGS } from '@/lib/promptsSwitch';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import usePlanMutations from './usePlanMutations';

/**
 * Revoking a plan cancels the escrow's limit and then removes the token approval for the
 * escrow. These tests drive the real mutations with only the wallet, the chain read and the
 * toasts replaced.
 */

const sendAndConfirm = vi.hoisted(() => vi.fn());
// What the chain answers: the approval for the escrow, and the escrow's spending limit
// (allowance, spent, expiresAt). An Error is thrown as the read's failure.
const onChain = vi.hoisted(() => ({ allowance: 0n as unknown, limit: [0n, 0n, 0n] as unknown }));
// The fee token profile the build selected; each profile is tried in turn below.
const profile = vi.hoisted(() => ({ current: undefined as unknown }));

const OWNER = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000c1';
const ESCROW = '0x00000000000000000000000000000000000000e5';

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn((options: { method: string; params?: unknown[] }) => ({
		method: options.method,
		params: options.params,
	})),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => {
	const account = { address: '0x00000000000000000000000000000000000000aa' };
	const wallet = { getChain: () => ({ id: 31337 }), getAccount: () => account };
	return {
		useActiveWallet: () => wallet,
		useSendAndConfirmTransaction: () => ({ mutateAsync: sendAndConfirm }),
	};
});
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	CONTRACTS: {
		31337: {
			token: { address: '0x00000000000000000000000000000000000000c1', abi: [] },
			agent: { address: '0x00000000000000000000000000000000000000a9', abi: [] },
			escrow: { address: '0x00000000000000000000000000000000000000e5', abi: [] },
		},
	},
}));
vi.mock('@/config/feeToken', async original => {
	const actual = await original<typeof import('@/config/feeToken')>();
	return {
		...actual,
		get FEE_TOKEN() {
			return profile.current ?? actual.FEE_TOKEN;
		},
	};
});
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(),
	useIsAwaitingFirstAnswer: vi.fn(() => false),
}));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn(), readPromptsSwitchNow: vi.fn() }));
vi.mock('@/lib/utils', async original => ({
	...(await original<typeof import('@/lib/utils')>()),
	wait: vi.fn(async () => undefined),
}));

const RECEIPT_NOT_FOUND = `Transaction receipt for 0x${'ab'.repeat(32)} not found after 100 blocks`;

function withGate(verdict: FeeTokenCheckState, switchState: PromptsSwitchState) {
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});
	vi.mocked(usePromptsSwitch).mockReturnValue(switchState);
	vi.mocked(readPromptsSwitchNow).mockReturnValue(switchState);
}

function renderPlanMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const onDone = vi.fn();
	const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
	const { result } = renderHook(() => usePlanMutations({ onStatus: vi.fn(), onDone }), {
		wrapper,
	});
	return { result, onDone, invalidate };
}

async function revoke() {
	const rendered = renderPlanMutations();
	await act(async () => {
		await rendered.result.current.revokeMutation.mutateAsync().catch(() => undefined);
	});
	return rendered;
}

const methods = () => vi.mocked(prepareContractCall).mock.calls.map(([call]) => call);
const cancelCall = expect.objectContaining({ method: 'cancelSpendingLimit' });
const clearCall = expect.objectContaining({ method: 'approve', params: [ESCROW, 0n] });

type Notice = { description?: string; action?: { label: string; onClick: () => void } };

/** The one notice shown by `kind`, its title and options. */
function onlyNotice(kind: 'error' | 'warning') {
	expect(toast[kind]).toHaveBeenCalledTimes(1);
	const [title, options] = vi.mocked(toast[kind]).mock.calls[0];
	return { title, options: options as Notice };
}

/** Presses the notice's action and waits for what it sends to settle. */
async function pressAction(notice: Notice, sendsBefore: number) {
	expect(notice.action?.label).toBe('Remove approval');
	await act(async () => {
		notice.action?.onClick();
	});
	await waitFor(() => expect(sendAndConfirm).toHaveBeenCalledTimes(sendsBefore + 1));
	await waitFor(() =>
		expect(
			vi.mocked(toast.success).mock.calls.length +
				vi.mocked(toast.error).mock.calls.length +
				vi.mocked(toast.warning).mock.calls.length,
		).toBeGreaterThan(1),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	profile.current = undefined;
	sendAndConfirm.mockResolvedValue({ status: 'success' });
	onChain.allowance = 10n;
	onChain.limit = [0n, 0n, 0n];
	vi.mocked(readContract).mockImplementation((async ({ method }: { method: unknown }) => {
		const answer = String(method).includes('spendingLimits') ? onChain.limit : onChain.allowance;
		if (answer instanceof Error) throw answer;
		return answer;
	}) as never);
	withGate('ok', { status: 'open' });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('revoking a plan with an approval in place', () => {
	it('cancels the limit, then sets the approval for the escrow to zero', async () => {
		const { onDone } = await revoke();

		expect(methods()).toEqual([cancelCall, clearCall]);
		expect(sendAndConfirm).toHaveBeenCalledTimes(2);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('reads the approval for the escrow only after the cancel is confirmed', async () => {
		await revoke();

		expect(readContract).toHaveBeenCalledTimes(1);
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({ contract: { address: TOKEN }, params: [OWNER, ESCROW] }),
		);
		const [firstSend] = sendAndConfirm.mock.invocationCallOrder;
		expect(vi.mocked(readContract).mock.invocationCallOrder[0]).toBeGreaterThan(firstSend);
	});

	it('says the agent can no longer spend once, after both are done', async () => {
		await revoke();

		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(toast.success).toHaveBeenCalledWith('Access Revoked', {
			description: 'The AI agent can no longer spend your tokens.',
		});
		const lastSend = sendAndConfirm.mock.invocationCallOrder[1];
		expect(vi.mocked(toast.success).mock.invocationCallOrder[0]).toBeGreaterThan(lastSend);
	});

	it('asks for the second signature with the two-step notice', async () => {
		await revoke();

		expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/^Step 2\/2: /));
	});
});

describe('revoking a plan with no approval left', () => {
	it('sends the cancel only', async () => {
		onChain.allowance = 0n;

		const { onDone } = await revoke();

		expect(methods()).toEqual([cancelCall]);
		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(onDone).toHaveBeenCalledTimes(1);
	});
});

describe('a revoke whose second step does not finish', () => {
	it.each([
		['is declined', () => new Error('user rejected')],
		['fails', () => new Error('execution reverted')],
	])('when it %s, says the plan is revoked and the approval remains', async (_, error) => {
		sendAndConfirm.mockResolvedValueOnce({ status: 'success' }).mockRejectedValueOnce(error());

		const { onDone } = await revoke();

		const { title, options } = onlyNotice('error');
		expect(title).toBe('Approval Not Removed');
		expect(options.description).toMatch(/plan is revoked/);
		expect(options.description).toMatch(/approval .*is still in place/);
		expect(options.action?.label).toBe('Remove approval');
		expect(toast.success).not.toHaveBeenCalled();
		// The plan is gone, so the dialog that showed it closes.
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('when its receipt says reverted, says the same', async () => {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockResolvedValueOnce({ status: 'reverted' });

		await revoke();

		const { title, options } = onlyNotice('error');
		expect(title).toBe('Approval Not Removed');
		expect(options.description).toMatch(/approval .*is still in place/);
		expect(options.action?.label).toBe('Remove approval');
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('when its receipt has not come, says it may still be confirmed and offers it again', async () => {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error(RECEIPT_NOT_FOUND));

		await revoke();

		expect(toast.error).not.toHaveBeenCalled();
		const { title, options } = onlyNotice('warning');
		expect(title).toBe('Removal Not Confirmed');
		expect(options.description).toMatch(/plan is revoked/);
		expect(options.description).toMatch(/may still be confirmed/);
		expect(options.description).not.toMatch(/failed/i);
		expect(options.action?.label).toBe('Remove approval');
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('gives the first line of the reason only, scrubbed', async () => {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(
				new Error('HTTP request failed at https://rpc.example/v2/KEY123\nbody'),
			);

		await revoke();

		const { options } = onlyNotice('error');
		expect(options.description).not.toContain('KEY123');
		expect(options.description).not.toContain('\n');
		expect(options.description).toMatch(/Reason: HTTP request failed at <url>$/);
	});
});

describe('removing the approval again from the notice', () => {
	it('sends exactly one approval of zero for the escrow, and nothing else', async () => {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error('user rejected'));
		await revoke();
		const { options } = onlyNotice('error');
		vi.mocked(prepareContractCall).mockClear();
		vi.mocked(readContract).mockClear();

		await pressAction(options, 2);

		expect(methods()).toEqual([clearCall]);
		expect(sendAndConfirm).toHaveBeenCalledTimes(3);
		// One read, of the account's spending limit on the escrow, before anything is sent.
		expect(readContract).toHaveBeenCalledTimes(1);
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({
				contract: { address: ESCROW },
				method: expect.stringContaining('spendingLimits'),
				params: [OWNER],
			}),
		);
		expect(vi.mocked(readContract).mock.invocationCallOrder[0]).toBeLessThan(
			sendAndConfirm.mock.invocationCallOrder[2],
		);
		expect(toast.success).toHaveBeenCalledWith('Access Revoked', {
			description: 'The AI agent can no longer spend your tokens.',
		});
	});

	it('when it fails again, says so and offers it again', async () => {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error('user rejected'))
			.mockResolvedValueOnce({ status: 'reverted' });
		await revoke();
		const { options } = onlyNotice('error');

		await pressAction(options, 2);

		expect(toast.error).toHaveBeenCalledTimes(2);
		const [title, again] = vi.mocked(toast.error).mock.calls[1];
		expect(title).toBe('Approval Not Removed');
		expect((again as Notice).action?.label).toBe('Remove approval');
		expect(toast.success).not.toHaveBeenCalled();
	});
});

describe('removing the approval while a plan is active', () => {
	/** A revoke whose second step was declined, leaving the notice; returns its options. */
	async function halfFinishedRevoke() {
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error('user rejected'));
		const rendered = await revoke();
		return { ...rendered, notice: onlyNotice('error').options };
	}

	/** Presses the notice's action and waits for its notice to be shown. */
	async function pressAndSettle(notice: Notice) {
		await act(async () => {
			notice.action?.onClick();
		});
		await waitFor(() => expect(toast.warning).toHaveBeenCalled());
	}

	it('sends nothing when a limit stands, and says Revoke is the way to remove it', async () => {
		const { notice } = await halfFinishedRevoke();
		// A new plan was set since, on this device or another.
		onChain.limit = [100n, 0n, 2_000_000_000n];
		vi.mocked(prepareContractCall).mockClear();

		await pressAndSettle(notice);

		expect(sendAndConfirm).toHaveBeenCalledTimes(2);
		expect(prepareContractCall).not.toHaveBeenCalled();
		const [title, options] = vi.mocked(toast.warning).mock.calls[0];
		expect(title).toBe('Plan Is Active');
		expect((options as Notice).description).toMatch(/plan is active/i);
		expect((options as Notice).description).toMatch(/Revoke/);
		expect((options as Notice).action).toBeUndefined();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('takes down the old notice, whose action would undo the plan', async () => {
		const { notice } = await halfFinishedRevoke();
		onChain.limit = [100n, 0n, 2_000_000_000n];

		await pressAndSettle(notice);

		expect(toast.dismiss).toHaveBeenCalledWith('plan-approval-not-cleared');
	});

	it.each([
		['fails', () => new Error('HTTP request failed')],
		['gives no limit', () => '0x'],
		['gives a limit with no expiry', () => [100n, 0n]],
	])('sends nothing when the limit read %s, and says to try again', async (_, answer) => {
		const { notice } = await halfFinishedRevoke();
		onChain.limit = answer();
		vi.mocked(prepareContractCall).mockClear();

		await pressAndSettle(notice);

		expect(sendAndConfirm).toHaveBeenCalledTimes(2);
		expect(prepareContractCall).not.toHaveBeenCalled();
		const [title, options] = vi.mocked(toast.warning).mock.calls[0];
		expect(title).toBe('Plan Not Checked');
		expect((options as Notice).description).toMatch(/could not be checked/);
		expect((options as Notice).description).toMatch(/try again/i);
		expect(toast.success).not.toHaveBeenCalled();
	});
});

// The exact keys the plan and the wallet's balance are read again with.
const PLAN_REFRESH = { queryKey: ['usagePlan'], refetchType: 'all' };
const BALANCE_REFRESH = {
	queryKey: getTokenBalanceQueryKey(31337, OWNER, TOKEN),
	refetchType: 'all',
};

describe('a revoke whose cancel has no receipt within the wait', () => {
	it('says it may still be mined, claims nothing and reads the plan and balance again', async () => {
		sendAndConfirm.mockRejectedValueOnce(new Error(RECEIPT_NOT_FOUND));

		const { onDone, invalidate } = await revoke();

		expect(toast.error).not.toHaveBeenCalled();
		const { title, options } = onlyNotice('warning');
		expect(title).toBe('Revoke Not Confirmed');
		expect(options.description).toMatch(/may still be mined/);
		expect(options.description).not.toMatch(/is revoked|failed/i);
		// Where the approval left behind is removed, once the cancel lands.
		expect(options.description).toMatch(/dashboard/);
		expect(options.description).not.toContain('0xabab');
		expect(toast.success).not.toHaveBeenCalled();
		expect(readContract).not.toHaveBeenCalled();
		expect(methods()).toEqual([cancelCall]);
		await waitFor(() => expect(invalidate).toHaveBeenCalledWith(PLAN_REFRESH));
		expect(invalidate).toHaveBeenCalledWith(BALANCE_REFRESH);
		expect(onDone).not.toHaveBeenCalled();
	});
});

describe('a revoke whose cancel does not go through', () => {
	it('when the cancel reverts, reads nothing, sends nothing more and says the revoke failed', async () => {
		sendAndConfirm.mockResolvedValueOnce({ status: 'reverted' });

		const { onDone } = await revoke();

		expect(readContract).not.toHaveBeenCalled();
		expect(methods()).toEqual([cancelCall]);
		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
		const { title, options } = onlyNotice('error');
		expect(title).toBe('Revoke Failed');
		expect(options.description).toMatch(/reverted/);
		expect(options.action).toBeUndefined();
		expect(toast.success).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});
});

describe('a revoke whose approval cannot be read', () => {
	it('says the plan is revoked, the approval could not be checked, and offers to remove it', async () => {
		onChain.allowance = new Error('HTTP request failed');

		const { onDone } = await revoke();

		expect(methods()).toEqual([cancelCall]);
		const { title, options } = onlyNotice('warning');
		expect(title).toBe('Approval Not Checked');
		expect(options.description).toMatch(/plan is revoked/);
		expect(options.description).toMatch(/could not be checked/);
		expect(toast.success).not.toHaveBeenCalled();
		expect(onDone).toHaveBeenCalledTimes(1);

		await pressAction(options, 1);

		expect(methods()).toEqual([cancelCall, clearCall]);
	});
});

describe('revoking and removing the approval never ask the payment gate', () => {
	const gateStates = FEE_TOKEN_STATES.flatMap(verdict => [
		{ verdict, switchState: { status: 'open' } as PromptsSwitchState, label: 'open' },
		{ verdict, switchState: { status: 'unknown' } as PromptsSwitchState, label: 'unknown' },
		...SWITCH_WORDINGS.map(wording => ({
			verdict,
			switchState: { status: 'closed', wording } as PromptsSwitchState,
			label: `closed for ${wording}`,
		})),
	]);

	it.each(gateStates)(
		'under $verdict with prompts $label, the revoke and the retry are sent',
		async ({ verdict, switchState }) => {
			withGate(verdict, switchState);
			sendAndConfirm
				.mockResolvedValueOnce({ status: 'success' })
				.mockRejectedValueOnce(new Error('user rejected'));

			await revoke();
			expect(methods()).toEqual([cancelCall, clearCall]);
			const { options } = onlyNotice('error');

			await pressAction(options, 2);

			expect(methods()).toEqual([cancelCall, clearCall, clearCall]);
		},
	);
});

describe.each(Object.values(FEE_TOKEN_PROFILES))(
	'revoking under the $symbol profile',
	(feeToken: FeeTokenProfile) => {
		beforeEach(() => {
			profile.current = feeToken;
		});

		it('cancels the limit and removes the approval', async () => {
			await revoke();

			expect(methods()).toEqual([cancelCall, clearCall]);
			expect(toast.success).toHaveBeenCalledTimes(1);
		});

		it('names no token in what it says when the approval remains', async () => {
			sendAndConfirm
				.mockResolvedValueOnce({ status: 'success' })
				.mockRejectedValueOnce(new Error('user rejected'));

			await revoke();

			const { options } = onlyNotice('error');
			Object.values(FEE_TOKEN_PROFILES).forEach(each =>
				expect(options.description).not.toContain(each.symbol),
			);
		});
	},
);
