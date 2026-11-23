import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useRecentActivity from '@/hooks/useRecentActivity';

// A fee token profile with six decimals: the amount must be read with the profile's decimals,
// not with the eighteen that formatEther assumes.
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS', decimals: 6 } }));

const { graphRequestMock } = vi.hoisted(() => ({ graphRequestMock: vi.fn() }));

vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = graphRequestMock;
	},
	gql: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
		strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
}));

vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ ownerAddress: '0x00000000000000000000000000000000000000aa' }),
}));

const TX = '0x4444444444444444444444444444444444444444444444444444444444444444';

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useRecentActivity with a fee token of six decimals', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('formats each amount with the profile decimals', async () => {
		graphRequestMock.mockResolvedValue({
			activities: [
				{
					id: `${TX}-1`,
					type: 'CANCEL',
					amount: '-250000',
					timestamp: '1700000000',
					transactionHash: TX,
				},
				{
					id: `${TX}-1-return`,
					type: 'CANCEL_RETURN',
					amount: '1000000',
					timestamp: '1700000000',
					transactionHash: TX,
				},
			],
		});
		const { result } = renderHook(() => useRecentActivity(20), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data?.map(r => r.formattedAmount)).toEqual(['-0.25', '1.0']);
	});

	it('gives each row the sign of its amount, read once from the chain value', async () => {
		graphRequestMock.mockResolvedValue({
			activities: [
				{
					id: `${TX}-2`,
					type: 'CANCEL',
					amount: '-1',
					timestamp: '1700000002',
					transactionHash: TX,
				},
				{
					id: `${TX}-3`,
					type: 'RENAME',
					amount: '0',
					timestamp: '1700000001',
					transactionHash: TX,
				},
				{
					id: `${TX}-4`,
					type: 'REFUND',
					amount: '1',
					timestamp: '1700000000',
					transactionHash: TX,
				},
			],
		});
		const { result } = renderHook(() => useRecentActivity(20), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data?.map(r => r.amountSign)).toEqual([-1, 0, 1]);
	});
});
