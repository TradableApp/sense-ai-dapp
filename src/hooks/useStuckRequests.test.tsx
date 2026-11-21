import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { readContract } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('graphql-request', () => ({
	GraphQLClient: class {
		request = request;
	},
	gql: (parts: TemplateStringsArray) => parts.join(''),
}));
vi.mock('thirdweb', () => ({ getContract: vi.fn(() => ({})), readContract: vi.fn() }));
vi.mock('thirdweb/react', () => ({
	useActiveWallet: () => ({
		getAccount: () => ({ address: '0x00000000000000000000000000000000000000aa' }),
		getChain: () => ({ id: 31337 }),
	}),
}));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	CONTRACTS: { 31337: { escrow: { address: '0x01', abi: [] } } },
}));

const SECRET = 'https://rpc.example/key-123';

async function loadHook() {
	vi.resetModules();
	vi.stubEnv('VITE_THE_GRAPH_API_URL', 'https://graph.example');
	return (await import('./useStuckRequests')).default;
}

function render(useStuckRequests: () => unknown, queryClient: QueryClient) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useStuckRequests() as { isError: boolean; data: unknown }, { wrapper });
}

beforeEach(() => {
	request.mockResolvedValue({ payments: [{ id: '7', amount: '1', createdAt: '100' }] });
	vi.mocked(readContract).mockRejectedValue(new TypeError(`fetch failed for ${SECRET}`));
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

describe('a stuck request whose escrow cannot be read', () => {
	// Swallowed, it would read as "nothing stuck" and hide a payment the user can get back.
	it('fails the query, so it is retried and its last answer kept', async () => {
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.data).toBeUndefined();
	});

	it('is reported by its name once per page load, without its message', async () => {
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);
		await waitFor(() => expect(result.current.isError).toBe(true));
		await queryClient.refetchQueries({ queryKey: ['stuckRequests'] });

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(context).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ check: 'stuck-requests' }),
				extra: expect.objectContaining({ errorName: 'TypeError' }),
			}),
		);
		expect(String((error as Error).message)).not.toContain('key-123');
		expect(JSON.stringify(context)).not.toContain('key-123');
	});
});

describe('the subgraph query for pending payments', () => {
	it('asks for each page with its size and offset', async () => {
		vi.mocked(readContract).mockResolvedValue([0, 0, 0, 0] as never);
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);
		await waitFor(() => expect(result.current.data).toBeDefined());

		expect(request).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ first: 100, skip: 0 }),
		);
	});
});
