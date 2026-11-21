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

async function loadModule() {
	vi.resetModules();
	vi.stubEnv('VITE_THE_GRAPH_API_URL', 'https://graph.example');
	return import('./useStuckRequests');
}

async function loadHook() {
	return (await loadModule()).default;
}

/** The escrow's `escrows(id)` answer: user, amount, time made, then the status. */
const escrowEntry = (status: number) => [
	'0x00000000000000000000000000000000000000aa',
	5n,
	100n,
	status,
];
const PENDING = 0;
const REFUNDED = 2;

/** The query's poll interval as it stands now. */
function pollInterval(queryClient: QueryClient) {
	const query = queryClient.getQueryCache().find({ queryKey: ['stuckRequests'] });
	const interval = query?.options.refetchInterval;
	return typeof interval === 'function' ? interval(query as never) : interval;
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

	// One failed read is not the answer: the query reads again, and the payment is found.
	it('is read again by the query, and then listed', async () => {
		vi.mocked(readContract)
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValue(escrowEntry(PENDING) as never);
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
		});

		const { result } = render(useStuckRequests, queryClient);

		await waitFor(() =>
			expect(result.current.data).toEqual([expect.objectContaining({ id: '7' })]),
		);
		expect(readContract).toHaveBeenCalledTimes(2);
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

describe("the escrow's word on a pending payment", () => {
	// The status is the fourth field: reading any other would take the user, the amount or the
	// time made for the status.
	it('lists one the escrow still holds', async () => {
		vi.mocked(readContract).mockResolvedValue(escrowEntry(PENDING) as never);
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);

		await waitFor(() =>
			expect(result.current.data).toEqual([expect.objectContaining({ id: '7' })]),
		);
	});

	it('leaves out one the escrow has settled', async () => {
		vi.mocked(readContract).mockResolvedValue([0, 0, 0, REFUNDED] as never);
		const useStuckRequests = await loadHook();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);

		await waitFor(() => expect(result.current.data).toEqual([]));
	});
});

describe('how often the stuck requests are read again', () => {
	const fullPage = Array.from({ length: 100 }, (_, i) => ({
		id: String(i + 1),
		amount: '1',
		createdAt: '100',
	}));

	it('is the usual minute when the last answer took one page', async () => {
		vi.mocked(readContract).mockResolvedValue(escrowEntry(PENDING) as never);
		const { default: useStuckRequests, STUCK_POLL_MS } = await loadModule();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);
		await waitFor(() => expect(result.current.data).toBeDefined());

		expect(STUCK_POLL_MS).toBe(60_000);
		expect(pollInterval(queryClient)).toBe(STUCK_POLL_MS);
	});

	// Each page is a query against the shared quota, and each candidate an escrow read.
	it('is slower when the last answer took more than one page', async () => {
		request
			.mockResolvedValueOnce({ payments: fullPage })
			.mockResolvedValueOnce({ payments: [{ id: '101', amount: '1', createdAt: '100' }] });
		vi.mocked(readContract).mockResolvedValue(escrowEntry(PENDING) as never);
		const {
			default: useStuckRequests,
			STUCK_POLL_MS,
			STUCK_POLL_MANY_PAGES_MS,
		} = await loadModule();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = render(useStuckRequests, queryClient);
		await waitFor(() => expect(result.current.data).toHaveLength(101));

		expect(STUCK_POLL_MANY_PAGES_MS).toBeGreaterThan(STUCK_POLL_MS);
		expect(pollInterval(queryClient)).toBe(STUCK_POLL_MANY_PAGES_MS);
	});
});
