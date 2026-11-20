import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN } from '@/config/feeToken';
import useFeeTokenCheck, { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import usePlanMutations from './usePlanMutations';

// What the wallet is asked to sign. Mocked here so the test can see each request.
const sendAndConfirm = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn((options: { method: string }) => ({ method: options.method })),
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
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(),
	useIsAwaitingFirstAnswer: vi.fn(() => false),
}));
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
	return { result, onDone };
}

type Mutations = ReturnType<typeof usePlanMutations>;

/** Starts an action and waits for it to settle, whichever way it ends. */
async function attempt(run: (_m: Mutations) => Promise<unknown>) {
	const { result, onDone } = renderPlanMutations();
	await act(async () => {
		await run(result.current).catch(() => undefined);
	});
	return { onDone };
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
		expect(toast.error).toHaveBeenCalledWith('Transaction Failed', {
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

describe('setting a plan before the check has answered once', () => {
	it('approves nothing and sends nothing, and says why', async () => {
		withVerdict('unknown');
		vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(true);

		const { onDone } = await attempt(setPlan);

		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirm).not.toHaveBeenCalled();
		expect(onDone).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Transaction Failed', {
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
