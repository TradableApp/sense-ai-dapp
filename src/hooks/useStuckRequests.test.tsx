import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
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
	const query = queryClient.getQueryCache().find({ queryKey: ['stuckRequests'], exact: false });
	// The hook's own options are merged into the query's.
	const { refetchInterval: interval } = (query?.options ?? {}) as {
		refetchInterval?: number | ((_query: unknown) => number);
	};
	return typeof interval === 'function' ? interval(query) : interval;
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

describe('a stuck request whose refund hour passes while the page is open', () => {
	const HOUR_MS = 3_600_000;
	// The margin after the hour before the button unlocks (`REFUND_UNLOCK_MARGIN_MS`).
	const MARGIN_MS = 30_000;
	const START = Date.UTC(2026, 0, 1, 12, 0, 0);

	/** A pending payment whose refund is offered `msFromStart` after START. */
	const opensAt = (msFromStart: number) => {
		const sentAt = Math.floor((START + msFromStart - HOUR_MS - MARGIN_MS) / 1000);
		request.mockResolvedValue({ payments: [{ id: '7', amount: '1', createdAt: String(sentAt) }] });
	};

	beforeEach(() => {
		vi.mocked(readContract).mockResolvedValue(escrowEntry(PENDING) as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	/** Lets the first read finish under the fake clock. */
	const settle = () =>
		act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});

	const tick = (ms: number) =>
		act(async () => {
			await vi.advanceTimersByTimeAsync(ms);
		});

	/** Loads the hook, then fakes the clock at START: loading the module needs real timers. */
	async function startAt() {
		const loaded = await loadModule();
		vi.useFakeTimers();
		vi.setSystemTime(START);
		return loaded;
	}

	/** The ids of the refund clock's intervals: the ones set with its period. */
	function refundClocks(REFUND_CLOCK_MS: number) {
		const set = vi.spyOn(globalThis, 'setInterval');
		const cleared = vi.spyOn(globalThis, 'clearInterval');
		return {
			started: () =>
				set.mock.calls.flatMap((call, index) =>
					call[1] === REFUND_CLOCK_MS ? [set.mock.results[index].value] : [],
				),
			cleared: () => cleared.mock.calls.map(([id]) => id),
		};
	}

	// The list is read from the subgraph once a minute at most; the hour does not wait for that.
	it('becomes refundable on the next tick of the clock, with no new read', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		opensAt(10_000);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = render(useStuckRequests, queryClient);
		await settle();
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: false })]);

		await tick(REFUND_CLOCK_MS);

		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);
		expect(request).toHaveBeenCalledTimes(1);
	});

	// The contract checks the time of the block that takes the refund, which can trail this
	// device's clock: the hour alone, on this clock, is not enough.
	it('is not refundable just after the hour, only once the margin has passed too', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		// The hour passes five seconds after START; the margin, thirty seconds after that.
		opensAt(5_000 + MARGIN_MS);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = render(useStuckRequests, queryClient);
		await settle();

		await tick(REFUND_CLOCK_MS);
		expect(Date.now()).toBeGreaterThan(START + 5_000);
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: false })]);

		await tick(2 * REFUND_CLOCK_MS);
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);
	});

	// A clock that fired once would leave a request whose time comes on a later tick locked
	// until the next read of the list.
	it('keeps ticking until the time comes', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		opensAt(REFUND_CLOCK_MS + 5_000);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = render(useStuckRequests, queryClient);
		await settle();

		await tick(REFUND_CLOCK_MS);
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: false })]);

		await tick(REFUND_CLOCK_MS);
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('stops its clock when the page unmounts', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		const clocks = refundClocks(REFUND_CLOCK_MS);
		opensAt(10 * REFUND_CLOCK_MS);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { unmount } = render(useStuckRequests, queryClient);
		await settle();
		expect(clocks.started()).not.toHaveLength(0);

		unmount();

		expect(clocks.cleared()).toEqual(expect.arrayContaining(clocks.started()));
	});

	// Nothing waits for its hour: a clock would only re-render the card for nothing.
	it('runs no clock while no request is waiting for its hour', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		const clocks = refundClocks(REFUND_CLOCK_MS);
		opensAt(-1_000);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = render(useStuckRequests, queryClient);
		await settle();
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);

		await tick(2 * REFUND_CLOCK_MS);

		const running = clocks.started().filter(id => !clocks.cleared().includes(id));
		expect(running).toEqual([]);
	});

	it('stays refundable once it is, whatever the clock says later', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		opensAt(10_000);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		vi.setSystemTime(START + 20_000);
		const { result } = render(useStuckRequests, queryClient);
		await settle();
		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);

		vi.setSystemTime(START - HOUR_MS);
		await tick(REFUND_CLOCK_MS);

		expect(result.current.data).toEqual([expect.objectContaining({ isRefundable: true })]);
	});

	// Unlocked by the clock rather than by a read, while another request keeps the clock
	// running: a clock set back must not lock it again.
	it('stays refundable once the clock unlocked it, when the clock is set back later', async () => {
		const { default: useStuckRequests, REFUND_CLOCK_MS } = await startAt();
		const sentAt = (msFromStart: number) =>
			String(Math.floor((START + msFromStart - HOUR_MS - MARGIN_MS) / 1000));
		request.mockResolvedValue({
			payments: [
				{ id: '7', amount: '1', createdAt: sentAt(REFUND_CLOCK_MS - 5_000) },
				{ id: '8', amount: '1', createdAt: sentAt(40 * REFUND_CLOCK_MS) },
			],
		});
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = render(useStuckRequests, queryClient);
		await settle();
		await tick(REFUND_CLOCK_MS);
		expect(result.current.data).toEqual([
			expect.objectContaining({ id: '7', isRefundable: true }),
			expect.objectContaining({ id: '8', isRefundable: false }),
		]);

		// Set back so the next tick reads START, before the first one's time.
		vi.setSystemTime(START - REFUND_CLOCK_MS);
		await tick(REFUND_CLOCK_MS);
		expect(Date.now()).toBeLessThan(START + REFUND_CLOCK_MS - 5_000);

		expect(result.current.data).toEqual([
			expect.objectContaining({ id: '7', isRefundable: true }),
			expect.objectContaining({ id: '8', isRefundable: false }),
		]);
	});
});
