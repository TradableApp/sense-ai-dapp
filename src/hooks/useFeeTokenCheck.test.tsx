import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';

import useFeeTokenCheck from './useFeeTokenCheck';

const CHAIN_ID = 84532;
const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const ESCROW = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const TREASURY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({
	getContract: vi.fn(({ address }: { address: string }) => ({ address })),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => ({ useActiveWallet: vi.fn() }));
vi.mock('@/config/feeToken', () => ({
	FEE_TOKEN: { symbol: 'PTS', transferable: false },
}));
vi.mock('@/config/contracts', () => {
	const fn = (name: string) => ({ type: 'function', name });
	return {
		CONTRACTS: {
			84532: {
				token: {
					address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
					abi: [fn('symbol'), fn('isTransferExempt')],
				},
				escrow: {
					address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
					abi: [fn('ableToken'), fn('treasury')],
				},
			},
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
			treasury: TREASURY,
			symbol: 'PTS',
			[`exempt:${ESCROW}`]: true,
			[`exempt:${TREASURY}`]: true,
			...over,
		};
		const answer = answers[key];
		if (answer instanceof Error) throw answer;
		return answer;
	}) as unknown as typeof readContract);
}

function wrapper({ children }: { children: ReactNode }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const connected = () =>
	vi.mocked(useActiveWallet).mockReturnValue({
		getChain: () => ({ id: CHAIN_ID }),
	} as unknown as ReturnType<typeof useActiveWallet>);

describe('useFeeTokenCheck', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connected();
	});
	afterEach(cleanup);

	it('does not stop payments before the chain has answered', () => {
		vi.mocked(readContract).mockReturnValue(new Promise(() => {}) as never);
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		expect(result.current).toEqual({ verdict: 'unknown', isBlocked: false });
	});

	it('passes when the chain agrees with the build', async () => {
		chainAnswers();
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		await waitFor(() => expect(result.current.verdict).toBe('ok'));
		expect(result.current.isBlocked).toBe(false);
	});

	it('stops payments when the escrow is not listed on the token', async () => {
		chainAnswers({ [`exempt:${ESCROW}`]: false });
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		await waitFor(() => expect(result.current.verdict).toBe('escrow-not-exempt'));
		expect(result.current.isBlocked).toBe(true);
	});

	it('stops payments when the escrow takes another token', async () => {
		chainAnswers({ [ESCROW_FEE_TOKEN_GETTER]: '0x5FbDB2315678afecb367f032d93F642f64180aa3' });
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		await waitFor(() => expect(result.current.isBlocked).toBe(true));
		expect(result.current.verdict).toBe('escrow-uses-other-token');
	});

	it('does not stop payments when a read fails, and reports the failure', async () => {
		chainAnswers({ treasury: new Error('429 Too Many Requests') });
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		expect(result.current).toEqual({ verdict: 'unknown', isBlocked: false });
		expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toEqual({
			tags: { check: 'fee-token' },
		});
	});

	it('reads nothing with no wallet connected', () => {
		vi.mocked(useActiveWallet).mockReturnValue(undefined);
		const { result } = renderHook(() => useFeeTokenCheck(), { wrapper });
		expect(result.current).toEqual({ verdict: 'unknown', isBlocked: false });
		expect(readContract).not.toHaveBeenCalled();
	});
});
