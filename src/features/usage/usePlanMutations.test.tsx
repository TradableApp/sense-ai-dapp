import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { getContract, prepareContractCall } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTRACTS } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import useFeeTokenCheck, { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { SWITCH_WORDINGS, switchCopy } from '@/lib/promptsSwitch';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import usePlanMutations from './usePlanMutations';

// What the wallet is asked to sign. Mocked here so the test can see each request.
const sendAndConfirm = vi.hoisted(() => vi.fn());
const getChain = vi.hoisted(() => vi.fn(() => ({ id: 31337 })));

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn((options: { method: string }) => ({ method: options.method })),
	// The approval left for the escrow after a revoke; none, so a revoke is one transaction.
	readContract: vi.fn(async () => 0n),
}));
vi.mock('thirdweb/react', () => {
	const account = { address: '0x00000000000000000000000000000000000000aa' };
	const wallet = { getChain, getAccount: () => account };
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
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(),
	useIsAwaitingFirstAnswer: vi.fn(() => false),
}));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn(), readPromptsSwitchNow: vi.fn() }));
// The real waits are two seconds each; nothing here depends on them.
vi.mock('@/lib/utils', async original => ({
	...(await original<typeof import('@/lib/utils')>()),
	wait: vi.fn(async () => undefined),
}));

const PLAN = { limitInWei: 100n, expiresAtTimestamp: 2_000_000_000n };

function withVerdict(verdict: FeeTokenCheckState) {
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});
}

function renderPlanMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const onDone = vi.fn();
	const { result } = renderHook(() => usePlanMutations({ onStatus: vi.fn(), onDone }), {
		wrapper,
	});
	return { result, onDone, queryClient };
}

type Mutations = ReturnType<typeof usePlanMutations>;

/** Starts an action and waits for it to settle, whichever way it ends. */
async function attempt(run: (_m: Mutations) => Promise<unknown>) {
	const { result, onDone, queryClient } = renderPlanMutations();
	const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
	await act(async () => {
		await run(result.current).catch(() => undefined);
	});
	return { onDone, invalidate };
}

const setPlan = (m: Mutations) => m.setPlanMutation.mutateAsync(PLAN);
const revoke = (m: Mutations) => m.revokeMutation.mutateAsync();

const stopped = FEE_TOKEN_STATES.filter(verdict => blocksAction(verdict, 'plan'));
const allowed = FEE_TOKEN_STATES.filter(verdict => !blocksAction(verdict, 'plan'));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	sendAndConfirm.mockResolvedValue({ status: 'success' });
	vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(false);
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
	vi.mocked(readPromptsSwitchNow).mockReturnValue({ status: 'open' });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('setting a plan the fee token check has switched off', () => {
	it('is switched off under some verdicts and allowed under others', () => {
		expect(stopped.length).toBeGreaterThan(0);
		expect(allowed).toEqual(expect.arrayContaining(['ok', 'unknown', 'treasury-not-exempt']));
	});

	it.each(stopped)('under %s nothing is approved, prepared or sent', async verdict => {
		withVerdict(verdict);

		const { onDone } = await attempt(setPlan);

		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirm).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	it.each(stopped)('under %s the user sees the banner words', async verdict => {
		withVerdict(verdict);

		await attempt(setPlan);

		const copy = feeTokenBlockCopy(verdict, FEE_TOKEN.symbol);
		// Nothing was sent, so it is not called a failed transaction.
		expect(toast.error).toHaveBeenCalledWith('Not sent', {
			description: `${copy?.title}. ${copy?.description}`,
		});
	});
});

describe('setting a plan the check lets through', () => {
	it.each(allowed)('under %s approves the token and then sets the limit', async verdict => {
		withVerdict(verdict);

		const { onDone } = await attempt(setPlan);

		expect(vi.mocked(prepareContractCall).mock.calls.map(([call]) => call)).toEqual([
			expect.objectContaining({ method: 'approve' }),
			expect.objectContaining({ method: 'setSpendingLimit' }),
		]);
		expect(sendAndConfirm).toHaveBeenCalledTimes(2);
		expect(onDone).toHaveBeenCalledTimes(1);
	});
});

describe('revoking a plan is never switched off', () => {
	it.each(FEE_TOKEN_STATES)('is sent under %s', async verdict => {
		withVerdict(verdict);

		await attempt(revoke);

		expect(prepareContractCall).toHaveBeenCalledWith(
			expect.objectContaining({ method: 'cancelSpendingLimit' }),
		);
		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
	});
});

describe('setting a plan while prompts are closed by the switch', () => {
	const closedCases = FEE_TOKEN_STATES.flatMap(verdict =>
		SWITCH_WORDINGS.map(wording => ({ verdict, wording })),
	);

	it.each(closedCases)(
		'under $verdict, closed for $wording, nothing is approved, prepared or sent',
		async ({ verdict, wording }) => {
			withVerdict(verdict);
			vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording });

			const { onDone } = await attempt(setPlan);

			expect(prepareContractCall).not.toHaveBeenCalled();
			expect(sendAndConfirm).not.toHaveBeenCalled();
			expect(onDone).not.toHaveBeenCalled();
		},
	);

	it.each(SWITCH_WORDINGS)('closed for %s, the user sees the switch words', async wording => {
		withVerdict('ok');
		vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording });

		await attempt(setPlan);

		const copy = switchCopy(wording);
		expect(toast.error).toHaveBeenCalledWith('Not sent', {
			description: `${copy.title}. ${copy.description}`,
		});
	});

	it.each(SWITCH_WORDINGS)('closed for %s, a plan can still be revoked', async wording => {
		withVerdict('ok');
		vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording });

		await attempt(revoke);

		expect(prepareContractCall).toHaveBeenCalledWith(
			expect.objectContaining({ method: 'cancelSpendingLimit' }),
		);
		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
	});
});

describe('a switch that closes between the approval and the limit', () => {
	it('sends no limit and says the approval stands and how to revoke it', async () => {
		withVerdict('ok');
		// The approval goes through; by the time it is confirmed, prompts are closed.
		sendAndConfirm.mockImplementationOnce(async () => {
			vi.mocked(readPromptsSwitchNow).mockReturnValue({ status: 'closed', wording: 'incident' });
			return { status: 'success' };
		});

		const { onDone } = await attempt(setPlan);

		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
		expect(prepareContractCall).not.toHaveBeenCalledWith(
			expect.objectContaining({ method: 'setSpendingLimit' }),
		);
		expect(onDone).not.toHaveBeenCalled();
		const [title, options] = vi.mocked(toast.error).mock.calls[0];
		const description = String((options as { description?: string }).description);
		expect(title).toBe('Limit Not Set');
		expect(description).toMatch(/approval went through and stands/);
		expect(description).toMatch(/Revoke/);
	});

	// While the gate is closed the limit cannot be set again, so the words do not offer it:
	// they say what closed it, in the gate's own words.
	it("says why in the gate's words, and does not offer to set the limit again", async () => {
		withVerdict('ok');
		sendAndConfirm.mockImplementationOnce(async () => {
			vi.mocked(readPromptsSwitchNow).mockReturnValue({ status: 'closed', wording: 'incident' });
			return { status: 'success' };
		});

		await attempt(setPlan);

		const description = String(
			(vi.mocked(toast.error).mock.calls[0][1] as { description?: string }).description,
		);
		expect(description).toContain(switchCopy('incident').title);
		expect(description).not.toMatch(/can be set again/);
		expect(description).not.toMatch(/Reason:/);
	});
});

describe('setting a plan before the check has answered once', () => {
	it('approves nothing and sends nothing, and says why', async () => {
		withVerdict('unknown');
		vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(true);

		const { onDone } = await attempt(setPlan);

		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirm).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Not sent', {
			description: AWAITING_CHECK_REASON,
		});
	});

	it('still lets a plan be revoked', async () => {
		withVerdict('unknown');
		vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(true);

		await attempt(revoke);

		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
	});
});

describe('a plan that was sent and failed', () => {
	it('is still called a failed transaction', async () => {
		withVerdict('ok');
		sendAndConfirm.mockRejectedValue(new Error('user rejected'));

		await attempt(setPlan);

		expect(toast.error).toHaveBeenCalledWith('Transaction Failed', {
			description: 'user rejected',
		});
	});

	// A dismissal of every toast would also take down the notice of a new version.
	it('takes down its own wallet notice, and no other toast', async () => {
		withVerdict('ok');
		vi.mocked(toast.info).mockReturnValue('approve-notice');
		sendAndConfirm.mockRejectedValue(new Error('user rejected'));

		await attempt(setPlan);

		expect(toast.dismiss).toHaveBeenCalledWith('approve-notice');
		expect(vi.mocked(toast.dismiss).mock.calls.every(call => call.length === 1)).toBe(true);
	});

	it('takes down the second notice when setting the limit fails', async () => {
		withVerdict('ok');
		vi.mocked(toast.info).mockReturnValueOnce('approve-notice').mockReturnValueOnce('limit-notice');
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error('x'));

		await attempt(setPlan);

		expect(toast.dismiss).toHaveBeenCalledWith('limit-notice');
		expect(vi.mocked(toast.dismiss).mock.calls.every(call => call.length === 1)).toBe(true);
	});
});

describe('a plan whose approval went through and whose limit then failed', () => {
	const approvedThenFailed = () => {
		withVerdict('ok');
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(new Error('user rejected'));
	};

	// The approval is on chain: "the transaction failed" alone would hide it.
	it('says the approval stands, what the failure was and how to stop spending', async () => {
		approvedThenFailed();

		await attempt(setPlan);

		expect(toast.error).toHaveBeenCalledTimes(1);
		const [title, options] = vi.mocked(toast.error).mock.calls[0];
		const description = String((options as { description?: string }).description);
		expect(title).toBe('Limit Not Set');
		expect(description).toMatch(/approval went through and stands/);
		expect(description).toMatch(/Revoke/);
		expect(description).not.toContain(FEE_TOKEN.symbol);
		// The guidance first, the reason last.
		expect(description.indexOf('user rejected')).toBeGreaterThan(description.indexOf('Revoke'));
		expect(description).toMatch(/user rejected\.?$/);
	});

	// The approval replaced the allowance: an earlier plan's limit still stands on the escrow
	// but can spend only up to the new approval. The escrow refuses a new limit, and Revoke,
	// while a prompt is pending: the words must hold in every case.
	it('says the approval is now the new amount and caps an earlier plan', async () => {
		approvedThenFailed();

		await attempt(setPlan);

		const description = String(
			(vi.mocked(toast.error).mock.calls[0][1] as { description?: string }).description,
		);
		expect(description).not.toMatch(/earlier plan still applies/);
		expect(description).toMatch(/approval is now the new amount/);
		expect(description).toMatch(/can spend only up to the new approval/);
		expect(description).toMatch(/limit can be set again once no prompt is pending/);
		expect(description).toMatch(/Revoke once no prompt is pending/);
	});

	// thirdweb's text runs to several lines with the RPC URL and the call data.
	it('gives the first line of the reason only, scrubbed and short', async () => {
		withVerdict('ok');
		const long = 'x'.repeat(300);
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(
				new Error(
					`HTTP request failed at https://rpc.example/v2/KEY123abc ${long}\nRequest body: {"data":"0xdeadbeefdeadbeefdeadbeef"}`,
				),
			);

		await attempt(setPlan);

		const description = String(
			(vi.mocked(toast.error).mock.calls[0][1] as { description?: string }).description,
		);
		expect(description).not.toContain('KEY123abc');
		expect(description).not.toContain('Request body');
		expect(description).not.toContain('\n');
		expect(description).toContain('<url>');
		expect(description).not.toContain('x'.repeat(121));
	});

	it('a limit whose receipt says reverted is a limit not set, and asks again', async () => {
		withVerdict('ok');
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockResolvedValueOnce({ status: 'reverted' });

		const { invalidate, onDone } = await attempt(setPlan);

		expect(toast.error).toHaveBeenCalledWith('Limit Not Set', expect.anything());
		expect(toast.success).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['usagePlan'] }));
	});

	// thirdweb rejects with this when no receipt has come after 100 blocks: the limit may
	// still be set, so it is not called a failure.
	it('a limit whose receipt has not come says it is not confirmed yet, and asks again', async () => {
		withVerdict('ok');
		sendAndConfirm
			.mockResolvedValueOnce({ status: 'success' })
			.mockRejectedValueOnce(
				new Error(`Transaction receipt for 0x${'ab'.repeat(32)} not found after 100 blocks`),
			);

		const { invalidate } = await attempt(setPlan);

		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).toHaveBeenCalledTimes(1);
		const [title, options] = vi.mocked(toast.warning).mock.calls[0];
		const description = String((options as { description?: string }).description);
		expect(title).toBe('Limit Not Confirmed');
		expect(description).toMatch(/approval went through and stands/);
		expect(description).toMatch(/not confirmed yet/);
		expect(description).toMatch(/may still be set/);
		expect(description).not.toMatch(/failed/);
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['usagePlan'] }));
	});

	it('asks the plan and the balance again', async () => {
		approvedThenFailed();

		const { invalidate, onDone } = await attempt(setPlan);

		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['usagePlan'] }));
		expect(invalidate).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: getTokenBalanceQueryKey(
					31337,
					'0x00000000000000000000000000000000000000aa',
					CONTRACTS[31337].token.address,
				),
			}),
		);
		expect(onDone).not.toHaveBeenCalled();
	});

	it('an approval whose receipt says reverted approved nothing and sets no limit', async () => {
		withVerdict('ok');
		sendAndConfirm.mockResolvedValueOnce({ status: 'reverted' });

		const { onDone } = await attempt(setPlan);

		expect(sendAndConfirm).toHaveBeenCalledTimes(1);
		expect(prepareContractCall).not.toHaveBeenCalledWith(
			expect.objectContaining({ method: 'setSpendingLimit' }),
		);
		const [title, options] = vi.mocked(toast.error).mock.calls[0];
		const description = String((options as { description?: string }).description);
		expect(title).toBe('Transaction Failed');
		expect(description).toMatch(/reverted/);
		expect(description).toMatch(/nothing was approved/);
		expect(toast.success).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
	});

	// thirdweb gives up waiting for the approval's receipt: it may still be mined, so it is not
	// called a failure, no limit is sent, and the plan and balance are read again.
	it('an approval whose receipt has not come is not confirmed, not failed', async () => {
		withVerdict('ok');
		sendAndConfirm.mockRejectedValueOnce(
			new Error(`Transaction receipt for 0x${'ab'.repeat(32)} not found after 100 blocks`),
		);

		const { invalidate, onDone } = await attempt(setPlan);

		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).toHaveBeenCalledTimes(1);
		const [title, options] = vi.mocked(toast.warning).mock.calls[0];
		const description = String((options as { description?: string }).description);
		expect(title).toBe('Approval Not Confirmed');
		expect(description).toMatch(/may still be mined/);
		expect(description).not.toMatch(/failed/i);
		expect(description).not.toContain(FEE_TOKEN.symbol);
		expect(prepareContractCall).not.toHaveBeenCalledWith(
			expect.objectContaining({ method: 'setSpendingLimit' }),
		);
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['usagePlan'] }));
		expect(onDone).not.toHaveBeenCalled();
	});

	it('a plan whose approval itself failed is a failed transaction and asks nothing again', async () => {
		withVerdict('ok');
		sendAndConfirm.mockRejectedValueOnce(new Error('user rejected'));

		const { invalidate } = await attempt(setPlan);

		expect(toast.error).toHaveBeenCalledWith('Transaction Failed', {
			description: 'user rejected',
		});
		expect(invalidate).not.toHaveBeenCalled();
	});
});

describe('a revoke that was sent and failed', () => {
	it('takes down its wallet notice and says the revoke failed', async () => {
		withVerdict('ok');
		vi.mocked(toast.info).mockReturnValue('revoke-notice');
		sendAndConfirm.mockRejectedValue(new Error('user rejected'));

		await attempt(revoke);

		expect(toast.dismiss).toHaveBeenCalledWith('revoke-notice');
		expect(toast.error).toHaveBeenCalledWith('Revoke Failed', { description: 'user rejected' });
	});
});

describe('the connected chain', () => {
	it('is read once, so the contracts and the chain a call is built for cannot differ', async () => {
		withVerdict('ok');
		// The wallet changes network between two reads.
		getChain.mockReturnValueOnce({ id: 31337 }).mockReturnValueOnce({ id: 999 });

		await attempt(revoke);

		expect(getContract).toHaveBeenCalledWith(
			expect.objectContaining({ chain: { id: 31337 }, address: CONTRACTS[31337].escrow.address }),
		);
	});
});
