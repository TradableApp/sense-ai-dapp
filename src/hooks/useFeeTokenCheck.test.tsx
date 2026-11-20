import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readContract } from 'thirdweb';
import { useActiveWalletChain } from 'thirdweb/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';

import useFeeTokenCheck, { forgetReportedFailures } from './useFeeTokenCheck';

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
vi.mock('thirdweb/react', () => ({ useActiveWalletChain: vi.fn() }));
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

	it('stops only direct fees when the treasury is not listed', async () => {
		chainAnswers({ [`exempt:${TREASURY}`]: false });
		const { result } = harness();
		await waitFor(() => expect(result.current.verdict).toBe('treasury-not-exempt'));
		expect(result.current.blocks('prompt')).toBe(false);
		expect(result.current.blocks('branch')).toBe(true);
	});

	it('does not stop payments when the first read fails, and reports the failure', async () => {
		chainAnswers({ treasury: new Error('first read: 429 Too Many Requests') });
		const { result } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		expect(result.current.verdict).toBe('unknown');
		expect(result.current.blocks('prompt')).toBe(false);
		expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
			tags: { check: 'fee-token' },
			fingerprint: ['fee-token-check'],
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
