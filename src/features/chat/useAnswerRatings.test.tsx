import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ratingDocId } from '@/lib/answerRating';
import { importVectorKey } from '@/lib/liveReasoning/vector.testdata';

import useAnswerRatings, { RATING_READ_CONCURRENCY } from './useAnswerRatings';

const AGENT = '0x00000000000000000000000000000000000000a1';

let sessionKey: CryptoKey | null = null;
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ sessionKey, ownerAddress: '0xowner' }),
}));
vi.mock('@/config/firebase', () => ({ db: {} }));

// Only a get by id exists here: a list, a query or a listener would fail to import.
let inFlight = 0;
let maxInFlight = 0;
const reads: string[] = [];
const stored = new Map<string, string>();
let failReads = false;
const releases: Array<() => void> = [];
let holdReads = false;

vi.mock('firebase/firestore', () => ({
	doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
	getDoc: async (ref: { collection: string; id: string }) => {
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		reads.push(ref.id);
		try {
			if (holdReads) {
				await new Promise<void>(resolve => {
					releases.push(resolve);
				});
			} else await Promise.resolve();
			if (failReads) {
				const error = new Error(`denied ${ref.id}`);
				error.name = 'FirebaseError';
				throw error;
			}
			const value = stored.get(ref.id);
			return { exists: () => value !== undefined, data: () => ({ feedbackValue: value }) };
		} finally {
			inFlight -= 1;
		}
	},
}));

const idFor = (messageId: string) =>
	ratingDocId(sessionKey as CryptoKey, {
		chainId: '84532',
		agentAddress: AGENT,
		conversationId: '7',
		messageId,
	});

function wrapper(client: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	};
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useAnswerRatings', () => {
	beforeEach(async () => {
		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
		sessionKey = await importVectorKey();
		inFlight = 0;
		maxInFlight = 0;
		reads.length = 0;
		stored.clear();
		failReads = false;
		holdReads = false;
		releases.length = 0;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("reads each shown answer's rating by its id and returns the ones that exist", async () => {
		stored.set(await idFor('2'), 'like');
		stored.set(await idFor('4'), 'dislike');

		const { result } = renderHook(() => useAnswerRatings('7', ['2', '4', '6']), {
			wrapper: wrapper(newClient()),
		});

		await waitFor(() => expect(result.current.ratings).toEqual({ 2: 'like', 4: 'dislike' }));
		expect(reads.sort()).toEqual([await idFor('2'), await idFor('4'), await idFor('6')].sort());
	});

	it(`never has more than ${RATING_READ_CONCURRENCY} reads in flight for a long conversation`, async () => {
		holdReads = true;
		const ids = Array.from({ length: 30 }, (_, i) => String(i * 2 + 2));

		renderHook(() => useAnswerRatings('7', ids), { wrapper: wrapper(newClient()) });

		await waitFor(() => expect(reads).toHaveLength(RATING_READ_CONCURRENCY));
		expect(RATING_READ_CONCURRENCY).toBeLessThanOrEqual(4);
		while (reads.length < ids.length || releases.length > 0) {
			// eslint-disable-next-line no-await-in-loop
			await waitFor(() => expect(releases.length).toBeGreaterThan(0));
			act(() => {
				releases.splice(0).forEach(release => release());
			});
		}
		expect(maxInFlight).toBe(RATING_READ_CONCURRENCY);
		expect(new Set(reads).size).toBe(ids.length);
	});

	it('reads only the new answer when one is added', async () => {
		const client = newClient();
		const { result, rerender } = renderHook(({ ids }) => useAnswerRatings('7', ids), {
			wrapper: wrapper(client),
			initialProps: { ids: ['2', '4'] },
		});
		await waitFor(() => expect(reads).toHaveLength(2));
		await waitFor(() => expect(result.current.ratings).toEqual({}));

		stored.set(await idFor('6'), 'like');
		rerender({ ids: ['2', '4', '6'] });

		await waitFor(() => expect(result.current.ratings).toEqual({ 6: 'like' }));
		expect(reads).toHaveLength(3);
		expect(reads[2]).toBe(await idFor('6'));
	});

	it('reads nothing without a session key', async () => {
		sessionKey = null;

		const { result } = renderHook(() => useAnswerRatings('7', ['2']), {
			wrapper: wrapper(newClient()),
		});

		await act(async () => {
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
		});
		expect(reads).toEqual([]);
		expect(result.current.ratings).toEqual({});
	});

	it('remember() shows a saved rating at once and a removal clears it, with no new read', async () => {
		const { result } = renderHook(() => useAnswerRatings('7', ['2']), {
			wrapper: wrapper(newClient()),
		});
		await waitFor(() => expect(reads).toHaveLength(1));

		act(() => result.current.remember('2', 'dislike'));
		await waitFor(() => expect(result.current.ratings).toEqual({ 2: 'dislike' }));

		act(() => result.current.remember('2', null));
		await waitFor(() => expect(result.current.ratings).toEqual({}));
		expect(reads).toHaveLength(1);
	});

	it('a rating saved while its read is still under way is not replaced when the read ends', async () => {
		holdReads = true;
		const { result } = renderHook(() => useAnswerRatings('7', ['2']), {
			wrapper: wrapper(newClient()),
		});
		await waitFor(() => expect(reads).toHaveLength(1));

		// The read found no rating when it started; the user rates before it has answered.
		act(() => result.current.remember('2', 'like'));
		await act(async () => {
			releases.splice(0).forEach(release => release());
		});

		await waitFor(() => expect(result.current.ratings).toEqual({ 2: 'like' }));
		await new Promise(resolve => {
			setTimeout(resolve, 20);
		});
		expect(result.current.ratings).toEqual({ 2: 'like' });
	});

	it('keeps no rating id in a query key', async () => {
		const client = newClient();
		renderHook(() => useAnswerRatings('7', ['2']), { wrapper: wrapper(client) });
		await waitFor(() => expect(reads).toHaveLength(1));

		const keys = JSON.stringify(
			client
				.getQueryCache()
				.getAll()
				.map(query => query.queryKey),
		);
		expect(keys).not.toContain(await idFor('2'));
		expect(keys).not.toMatch(/[A-Za-z0-9_-]{43}/);
	});

	it('a failed read shows no rating and logs the error by name only, never the id', async () => {
		failReads = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { result } = renderHook(() => useAnswerRatings('7', ['2']), {
			wrapper: wrapper(newClient()),
		});

		await waitFor(() => expect(warn).toHaveBeenCalled());
		const logged = warn.mock.calls.flat().map(String).join(' ');
		expect(logged).toContain('FirebaseError');
		expect(logged).not.toContain(await idFor('2'));
		expect(result.current.ratings).toEqual({});
	});
});
