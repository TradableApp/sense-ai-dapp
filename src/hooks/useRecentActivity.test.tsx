import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { Ban, RotateCcw } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useRecentActivity from '@/hooks/useRecentActivity';

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

const CANCEL_TX = '0x1111111111111111111111111111111111111111111111111111111111111111';

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function rowsFor(activities: Array<Record<string, string>>) {
	graphRequestMock.mockResolvedValue({ activities });
	const { result } = renderHook(() => useRecentActivity(20), { wrapper });
	await waitFor(() => expect(result.current.isSuccess).toBe(true));
	return result.current.data ?? [];
}

describe('useRecentActivity', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('labels the amount a cancel hands back, with the refund icon and a positive amount', async () => {
		const [row] = await rowsFor([
			{
				id: `${CANCEL_TX}-3-return`,
				type: 'CANCEL_RETURN',
				amount: '1000000000000000000',
				timestamp: '1700000000',
				transactionHash: CANCEL_TX,
			},
		]);

		expect(row.label).toBe('Prompt Amount Returned');
		expect(row.icon).toBe(RotateCcw);
		expect(row.formattedAmount).toBe('1.0');
	});

	it('keeps the cancel row and its returned amount as two rows with their own ids', async () => {
		const rows = await rowsFor([
			{
				id: `${CANCEL_TX}-3`,
				type: 'CANCEL',
				amount: '-100000000000000000',
				timestamp: '1700000000',
				transactionHash: CANCEL_TX,
			},
			{
				id: `${CANCEL_TX}-3-return`,
				type: 'CANCEL_RETURN',
				amount: '1000000000000000000',
				timestamp: '1700000000',
				transactionHash: CANCEL_TX,
			},
		]);

		expect(rows.map(r => r.id)).toEqual([`${CANCEL_TX}-3`, `${CANCEL_TX}-3-return`]);
		expect(rows.map(r => r.label)).toEqual(['Prompt Cancelled', 'Prompt Amount Returned']);
		expect(rows[0].icon).toBe(Ban);
		expect(rows.map(r => r.formattedAmount)).toEqual(['-0.1', '1.0']);
	});

	it('still labels a type it does not know as an unknown action', async () => {
		const [row] = await rowsFor([
			{
				id: `${CANCEL_TX}-9`,
				type: 'SOMETHING_NEW',
				amount: '0',
				timestamp: '1700000000',
				transactionHash: CANCEL_TX,
			},
		]);

		expect(row.label).toBe('Unknown Action');
	});
});
