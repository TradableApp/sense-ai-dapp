import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FeeTokenVerdict, readFeeTokenVerdict } from '@/lib/feeTokenCheck';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';

import usePlanMutations from './usePlanMutations';

/**
 * The plan hold through the real `useFeeTokenCheck` and `useIsAwaitingFirstAnswer`: only the
 * chain reads underneath are replaced. The other plan tests mock the hook, so a change in
 * how it decides that the check is still waiting would leave them green.
 */

const sendAndConfirm = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn((options: { method: string }) => ({ method: options.method })),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => {
	const chain = { id: 31337 };
	const account = { address: '0x00000000000000000000000000000000000000aa' };
	const wallet = { getChain: () => chain, getAccount: () => account };
	return {
		useActiveWallet: () => wallet,
		useActiveWalletChain: () => chain,
		useSendAndConfirmTransaction: () => ({ mutateAsync: sendAndConfirm }),
	};
});
vi.mock('thirdweb/rpc', () => ({ eth_getCode: vi.fn(), getRpcClient: vi.fn() }));
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
// The chain's answer, held until the test gives it.
vi.mock('@/lib/feeTokenCheck', async original => ({
	...(await original<typeof import('@/lib/feeTokenCheck')>()),
	readFeeTokenVerdict: vi.fn(),
}));
vi.mock('@/lib/utils', async original => ({
	...(await original<typeof import('@/lib/utils')>()),
	wait: vi.fn(async () => undefined),
}));

const PLAN = { limitInWei: 100n, expiresAtTimestamp: 2_000_000_000n };

let answer: (_verdict: FeeTokenVerdict) => void = () => undefined;

function renderPlanMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => usePlanMutations({ onStatus: vi.fn(), onDone: vi.fn() }), { wrapper })
		.result;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	sendAndConfirm.mockResolvedValue({ status: 'success' });
	vi.mocked(readFeeTokenVerdict).mockImplementation(
		() =>
			new Promise(resolve => {
				answer = resolve;
			}),
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('setting a plan, through the real fee token check', () => {
	it('is held while the check has not answered: nothing is approved and the user is told why', async () => {
		const result = renderPlanMutations();
		await waitFor(() => expect(readFeeTokenVerdict).toHaveBeenCalled());

		await act(async () => {
			await result.current.setPlanMutation.mutateAsync(PLAN).catch(() => undefined);
		});

		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirm).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Not sent', { description: AWAITING_CHECK_REASON });
	});

	it('goes through once the check has answered', async () => {
		const result = renderPlanMutations();
		await waitFor(() => expect(readFeeTokenVerdict).toHaveBeenCalled());
		await act(async () => {
			answer('ok');
		});

		await waitFor(async () => {
			await act(async () => {
				await result.current.setPlanMutation.mutateAsync(PLAN).catch(() => undefined);
			});
			expect(sendAndConfirm).toHaveBeenCalledTimes(2);
		});
		expect(vi.mocked(prepareContractCall).mock.calls.map(([call]) => call)).toEqual([
			expect.objectContaining({ method: 'approve' }),
			expect.objectContaining({ method: 'setSpendingLimit' }),
		]);
	});
});
