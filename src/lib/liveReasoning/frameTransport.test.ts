import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	IDLE_GIVE_UP_MS,
	MAX_EVENT_CHARS,
	MAX_LINE_CHARS,
	MAX_STALLED_CONNECTIONS,
	MIN_RETRY_MS,
	startFrameStream,
	type StreamEvent,
	type StreamFetch,
	type StreamRequestInit,
	type StreamResponse,
} from './frameTransport';

const URL_42 = 'https://stream.example/stream/42';
const PROOF = 'zmsj4OksK8D2N9JMs__j2qRCsgSGomdTiRR9Dl6UUb4';
const RUN = '0123456789abcdef';
const STREAM_RETRY_MS = 2_000;

/** A response body that yields the given chunks, then ends (or stays open when `hold`). */
function body(chunks: string[], { hold = false } = {}) {
	const encoder = new TextEncoder();
	const queue = [...chunks];
	let cancelled = false;
	return {
		getReader: () => ({
			read: async () => {
				const next = queue.shift();
				if (next !== undefined) return { done: false, value: encoder.encode(next) };
				if (hold && !cancelled) await new Promise(() => {});
				return { done: true, value: undefined };
			},
			cancel: async () => {
				cancelled = true;
			},
		}),
	} as unknown as ReadableStream<Uint8Array>;
}

const ok = (chunks: string[], opts?: { hold?: boolean }): StreamResponse => ({
	status: 200,
	headers: new Headers({ 'Content-Type': 'text/event-stream' }),
	body: body(chunks, opts),
});

const refusal = (status: number, retryAfter?: string): StreamResponse => ({
	status,
	headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
	body: body([]),
});

const event = (seq: number, data = `iv${seq}.ct${seq}`) =>
	`id: ${RUN}.${seq}\nevent: frame\ndata: ${data}\n\n`;

interface Harness {
	fetchImpl: ReturnType<typeof vi.fn>;
	events: StreamEvent[];
	stops: string[];
	cursor: { value: string | null };
	handle: ReturnType<typeof startFrameStream>;
}

interface StartOptions {
	/** False: frames arrive but never move the cursor (undecryptable, refused by the schema). */
	applies?: boolean;
	/** True: a frame is applied a few microtasks after it arrives, as a decrypt is. */
	appliesLater?: boolean;
	/** The response given once the listed ones run out; a held-open empty stream by default. */
	repeat?: () => StreamResponse;
}

/** The most requests a test answers before it stops responding (a storm shows as this count). */
const STORM_CAP = 1_000;

function start(responses: Array<StreamResponse | Error>, opts: StartOptions = {}): Harness {
	const { applies = true, appliesLater = false, repeat = () => ok([], { hold: true }) } = opts;
	const queue = [...responses];
	const fetchImpl = vi.fn(async (_url: string, init: StreamRequestInit) => {
		const next =
			fetchImpl.mock.calls.length > STORM_CAP ? ok([], { hold: true }) : queue.shift() ?? repeat();
		if (next instanceof Error) throw next;
		// The request is aborted through its signal, as a real fetch is.
		if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
		return next;
	});
	const events: StreamEvent[] = [];
	const stops: string[] = [];
	const cursor = { value: null as string | null };
	const apply = (e: StreamEvent) => {
		if (applies) cursor.value = e.id;
	};
	const handle = startFrameStream({
		url: URL_42,
		proof: PROOF,
		// The cursor follows the frames applied, as the reducer's does.
		onEvent: e => {
			events.push(e);
			if (!appliesLater) return apply(e);
			return Promise.resolve()
				.then(() => undefined)
				.then(() => apply(e));
		},
		getCursor: () => cursor.value,
		onStop: reason => stops.push(reason),
		fetchImpl: fetchImpl as unknown as StreamFetch,
		random: () => 0,
	});
	return { fetchImpl, events, stops, cursor, handle };
}

const headersOf = (h: Harness, call: number) =>
	new Headers(h.fetchImpl.mock.calls[call][1].headers as ConstructorParameters<typeof Headers>[0]);

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the frame transport', () => {
	it('reads frame events split at any point, a line included, and skips comments', async () => {
		const whole = `retry: 2000\n\n: ping\n\n${event(0)}${event(1)}`;
		const h = start([
			ok([whole.slice(0, 20), whole.slice(20, 37), whole.slice(37, 61), whole.slice(61)]),
		]);

		await vi.advanceTimersByTimeAsync(0);

		expect(h.events).toEqual([
			{ id: `${RUN}.0`, data: 'iv0.ct0' },
			{ id: `${RUN}.1`, data: 'iv1.ct1' },
		]);
		h.handle.stop();
	});

	it('ignores an event of another name or with no id', async () => {
		const h = start([
			ok([`id: ${RUN}.0\nevent: other\ndata: x.y\n\nevent: frame\ndata: x.y\n\n${event(1)}`]),
		]);

		await vi.advanceTimersByTimeAsync(0);

		expect(h.events.map(e => e.id)).toEqual([`${RUN}.1`]);
		h.handle.stop();
	});

	it('sends the proof in a header and never in the URL', async () => {
		const h = start([ok([], { hold: true })]);

		await vi.advanceTimersByTimeAsync(0);

		const [url, init] = h.fetchImpl.mock.calls[0];
		expect(url).toBe(URL_42);
		expect(url).not.toContain(PROOF);
		expect(headersOf(h, 0).get('X-SenseAI-Stream-Proof')).toBe(PROOF);
		expect(headersOf(h, 0).get('Accept')).toBe('text/event-stream');
		expect(headersOf(h, 0).has('Last-Event-ID')).toBe(false);
		expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
		h.handle.stop();
	});

	it('reconnects with Last-Event-ID after the server ends the response', async () => {
		const h = start([ok([event(0), event(1)]), ok([], { hold: true })]);

		// A response that delivered frames is followed at once (0 ms) by the next connection.
		await vi.advanceTimersByTimeAsync(0);

		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		expect(headersOf(h, 1).get('Last-Event-ID')).toBe(`${RUN}.1`);
		h.handle.stop();
	});

	it('waits the retry line before reconnecting after a response that carried no frame', async () => {
		const h = start([ok(['retry: 3000\n\n: ping\n\n']), ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);

		// The server's retry line said 3 000 ms.
		await vi.advanceTimersByTimeAsync(2_999);
		expect(h.fetchImpl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		h.handle.stop();
	});

	it.each([
		[404, '2', 2_000],
		[429, '5', 5_000],
		[503, '10', 10_000],
	])('retries a %i after its Retry-After of %s s', async (status, retryAfter, waitMs) => {
		const h = start([refusal(status, retryAfter), ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);

		// Retry-After is in seconds: the next request goes exactly waitMs later, not before.
		await vi.advanceTimersByTimeAsync(waitMs - 1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		h.handle.stop();
	});

	it.each([
		[404, 'a refusal that is retried'],
		[403, 'a refusal that stops the stream'],
		[500, 'a status the contract does not name'],
	])('discards the body of a %i (%s), so the connection is released', async status => {
		const cancel = vi.fn(async () => undefined);
		const refused: StreamResponse = {
			status,
			headers: new Headers(),
			body: { cancel } as unknown as ReadableStream<Uint8Array>,
		};
		const h = start([refused, ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);

		expect(cancel).toHaveBeenCalledTimes(1);
		h.handle.stop();
	});

	it('still retries when discarding a refused body fails', async () => {
		const refused: StreamResponse = {
			status: 404,
			headers: new Headers({ 'Retry-After': '2' }),
			body: {
				cancel: async () => {
					throw new Error('locked');
				},
			} as unknown as ReadableStream<Uint8Array>,
		};
		const h = start([refused, ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(2_000);

		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		h.handle.stop();
	});

	it('never retries sooner than the 1 s floor, whatever Retry-After says', async () => {
		const h = start([refusal(503, '0'), ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		expect(MIN_RETRY_MS).toBe(1_000);
		h.handle.stop();
	});

	it('backs off after a network failure, doubling from 1 s', async () => {
		const h = start([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
		await vi.advanceTimersByTimeAsync(0);

		// With no jitter (random = 0): 1 000 ms after the first failure, 2 000 ms after the second.
		await vi.advanceTimersByTimeAsync(1_000);
		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1_999);
		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.fetchImpl).toHaveBeenCalledTimes(3);
		h.handle.stop();
	});

	it.each([
		[403, 'proof-refused'],
		[410, 'finished'],
		[400, 'bad-request'],
	])('stops on a %i and asks no more', async (status, reason) => {
		const h = start([refusal(status)]);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(h.stops).toEqual([reason]);
		expect(h.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('aborts the open request when stopped and asks no more', async () => {
		const h = start([ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);
		const { signal } = h.fetchImpl.mock.calls[0][1] as StreamRequestInit;

		h.handle.stop();
		await vi.advanceTimersByTimeAsync(60_000);

		expect(signal?.aborted).toBe(true);
		expect(h.fetchImpl).toHaveBeenCalledTimes(1);
		expect(h.stops).toEqual([]);
	});

	it('reconnects with no cursor when asked for a fresh connection', async () => {
		const h = start([ok([event(0)], { hold: true }), ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);
		expect(h.cursor.value).toBe(`${RUN}.0`);

		h.handle.reconnect(true);
		await vi.advanceTimersByTimeAsync(0);

		expect(h.fetchImpl).toHaveBeenCalledTimes(2);
		expect(headersOf(h, 1).has('Last-Event-ID')).toBe(false);
		h.handle.stop();
	});

	it('reconnects from the cursor when asked to', async () => {
		const h = start([ok([event(0)], { hold: true }), ok([], { hold: true })]);
		await vi.advanceTimersByTimeAsync(0);

		h.handle.reconnect(false);
		await vi.advanceTimersByTimeAsync(0);

		expect(headersOf(h, 1).get('Last-Event-ID')).toBe(`${RUN}.0`);
		h.handle.stop();
	});

	it('gives up after 10 minutes without a frame', async () => {
		const h = start([]);
		await vi.advanceTimersByTimeAsync(0);

		// IDLE_GIVE_UP_MS = 10 min = 600 000 ms, counted from the start with no frame since.
		await vi.advanceTimersByTimeAsync(IDLE_GIVE_UP_MS - 1);
		expect(h.stops).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);

		expect(IDLE_GIVE_UP_MS).toBe(600_000);
		expect(h.stops).toEqual(['idle']);
	});

	describe('progress is the cursor moving, not a frame arriving', () => {
		const LONG_LINE = `data: ${'x'.repeat(MAX_LINE_CHARS + 1)}`;
		const LONG_SPAN_MS = 30 * 60 * 1000;

		it.each([
			['a frame that is never applied, replayed on every connection', () => ok([event(1)])],
			['an over-long line', () => ok([LONG_LINE])],
			['a frame that is never applied, then an over-long line', () => ok([event(1), LONG_LINE])],
		])('%s: a bounded number of requests, then it stops as finished', async (_case, respond) => {
			const h = start([], { applies: false, repeat: respond });

			await vi.advanceTimersByTimeAsync(LONG_SPAN_MS);

			expect(h.fetchImpl).toHaveBeenCalledTimes(MAX_STALLED_CONNECTIONS);
			expect(h.stops).toEqual(['finished']);
		});

		it('backs off between connections that made no progress, doubling from 1 s', async () => {
			const h = start([], { applies: false, repeat: () => ok([event(1)]) });
			await vi.advanceTimersByTimeAsync(0);
			expect(h.fetchImpl).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(2 * MIN_RETRY_MS - 1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(3);
			h.handle.stop();
		});

		it('reconnects at once after each response that moved the cursor, a frame per poll', async () => {
			const polls = [1, 2, 3, 4, 5, 6, 7, 8].map(seq => ok([event(seq)]));
			const h = start(polls);

			// Any wait after a response without progress is at least the 1 s floor.
			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);

			expect(h.fetchImpl).toHaveBeenCalledTimes(polls.length + 1);
			expect(headersOf(h, polls.length).get('Last-Event-ID')).toBe(`${RUN}.8`);
			expect(h.stops).toEqual([]);
			h.handle.stop();
		});

		it('waits for frames still being applied before judging the response', async () => {
			const polls = [1, 2, 3, 4, 5, 6, 7, 8].map(seq => ok([event(seq)]));
			const h = start(polls, { appliesLater: true });

			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);

			expect(h.fetchImpl).toHaveBeenCalledTimes(polls.length + 1);
			expect(headersOf(h, polls.length).get('Last-Event-ID')).toBe(`${RUN}.8`);
			h.handle.stop();
		});

		it('reconnects at once after a response that ended once its frames were applied', async () => {
			const h = start([ok([event(0), event(1), event(2)])], { appliesLater: true });

			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);

			expect(h.fetchImpl).toHaveBeenCalledTimes(2);
			h.handle.stop();
		});

		it('counts again from nothing after any progress', async () => {
			const stuck = () => ok([event(1)]);
			const responses = [
				...Array.from({ length: MAX_STALLED_CONNECTIONS - 1 }, stuck),
				ok([event(0)]),
				...Array.from({ length: MAX_STALLED_CONNECTIONS - 1 }, stuck),
			];
			let applied = false;
			// Only the frame with seq 0 is applied; the replayed seq 1 never is.
			const fetchImpl = vi.fn(async () => responses.shift() ?? ok([], { hold: true }));
			const cursor = { value: null as string | null };
			const stops: string[] = [];
			const handle = startFrameStream({
				url: URL_42,
				proof: PROOF,
				onEvent: e => {
					if (e.id === `${RUN}.0`) {
						cursor.value = e.id;
						applied = true;
					}
				},
				getCursor: () => cursor.value,
				onStop: reason => stops.push(reason),
				fetchImpl: fetchImpl as unknown as StreamFetch,
				random: () => 0,
			});

			// Shorter than the idle limit, which the held-open last connection would reach.
			await vi.advanceTimersByTimeAsync(IDLE_GIVE_UP_MS / 2);

			expect(applied).toBe(true);
			expect(stops).toEqual([]);
			// 2N - 1 connections answered as listed, then one held open: never stopped.
			expect(fetchImpl).toHaveBeenCalledTimes(2 * MAX_STALLED_CONNECTIONS);
			handle.stop();
		});

		it('keeps polling through quiet responses that carry no frame, at the server pace', async () => {
			const quiet = () => ok([`retry: ${STREAM_RETRY_MS}\n\n: ping\n\n`]);
			const responses = [...Array.from({ length: 25 }, quiet), ok([event(0)])];
			const h = start(responses);

			// Each quiet response is followed after the server's retry line, never stopped for it.
			await vi.advanceTimersByTimeAsync(25 * STREAM_RETRY_MS + MIN_RETRY_MS - 1);

			expect(h.stops).toEqual([]);
			expect(h.events.map(e => e.id)).toEqual([`${RUN}.0`]);
			expect(h.fetchImpl).toHaveBeenCalledTimes(27);
			h.handle.stop();
		});
	});

	describe('timers and limits', () => {
		it('starts the idle wait again on each applied frame, so a flowing stream is never idle', async () => {
			const h = start([ok([event(0)], { hold: true })]);
			await vi.advanceTimersByTimeAsync(0);
			const fiveMinutes = 5 * 60 * 1000;

			// A frame every five minutes for twenty minutes, each on a fresh connection.
			for (let seq = 1; seq <= 4; seq += 1) {
				// eslint-disable-next-line no-await-in-loop
				await vi.advanceTimersByTimeAsync(fiveMinutes);
				h.fetchImpl.mockResolvedValueOnce(ok([event(seq)], { hold: true }));
				h.handle.reconnect(false);
			}
			await vi.advanceTimersByTimeAsync(fiveMinutes);

			expect(h.stops).toEqual([]);
			await vi.advanceTimersByTimeAsync(IDLE_GIVE_UP_MS);
			expect(h.stops).toEqual(['idle']);
		});

		it('gives up when frames keep arriving but none is applied for 10 minutes', async () => {
			// One held-open connection that receives an unappliable frame every minute.
			const chunks = Array.from({ length: 12 }, () => event(1));
			let push: (() => void) | null = null;
			const encoder = new TextEncoder();
			const trickle: StreamResponse = {
				status: 200,
				headers: new Headers(),
				body: {
					getReader: () => ({
						read: () =>
							new Promise(resolve => {
								push = () => resolve({ done: false, value: encoder.encode(chunks.shift() ?? '') });
							}),
						cancel: async () => undefined,
					}),
				} as unknown as ReadableStream<Uint8Array>,
			};
			const h = start([trickle], { applies: false });
			await vi.advanceTimersByTimeAsync(0);

			for (let minute = 1; minute < 10; minute += 1) {
				push?.();
				// eslint-disable-next-line no-await-in-loop
				await vi.advanceTimersByTimeAsync(60_000);
			}
			expect(h.stops).toEqual([]);
			push?.();
			await vi.advanceTimersByTimeAsync(60_000);

			expect(h.events.length).toBeGreaterThanOrEqual(10);
			expect(h.stops).toEqual(['idle']);
		});

		it('backs off from 1 s again after progress, not from where the failures left off', async () => {
			const fail = () => new TypeError('Failed to fetch');
			const h = start([fail(), fail(), ok([event(0)]), fail(), ok([], { hold: true })]);
			await vi.advanceTimersByTimeAsync(0);
			// Failures at 0 and 1 s; the response with a frame at 3 s; the next request at once.
			await vi.advanceTimersByTimeAsync(3_000 + 1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(4);

			// That request failed: the next comes 1 s later, not 4 s.
			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS);
			expect(h.fetchImpl).toHaveBeenCalledTimes(5);
			h.handle.stop();
		});

		it('never waits less than the 1 s floor, whatever the retry line says', async () => {
			const h = start([ok(['retry: 0\n\n: ping\n\n']), ok([], { hold: true })]);
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS - 1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(h.fetchImpl).toHaveBeenCalledTimes(2);
			h.handle.stop();
		});

		it('uses the backoff when Retry-After is not a short whole number of seconds', async () => {
			const h = start([refusal(503, '999999'), ok([], { hold: true })]);
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(MIN_RETRY_MS);

			expect(h.fetchImpl).toHaveBeenCalledTimes(2);
			h.handle.stop();
		});

		it('takes a CRLF split across two chunks as one line end', async () => {
			const h = start([
				ok([`id: ${RUN}.0\r`, `\nevent: frame\r\ndata: iv.ct\r\n\r\n`], { hold: true }),
			]);

			await vi.advanceTimersByTimeAsync(0);

			expect(h.events).toEqual([{ id: `${RUN}.0`, data: 'iv.ct' }]);
			h.handle.stop();
		});
	});

	describe('what a response may hold', () => {
		it('follows no redirect, so the proof header never reaches another origin', async () => {
			const h = start([ok([], { hold: true })]);

			await vi.advanceTimersByTimeAsync(0);

			expect(h.fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
			h.handle.stop();
		});

		it('takes data lines that add up past the event cap as no frame, and stops after a few', async () => {
			const line = `data: ${'x'.repeat(1024)}\n`;
			const lines = Array.from({ length: Math.ceil(MAX_EVENT_CHARS / 1024) + 1 }, () => line);
			const h = start([], { repeat: () => ok([`id: ${RUN}.0\nevent: frame\n`, ...lines]) });

			await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

			expect(h.events).toEqual([]);
			expect(h.fetchImpl).toHaveBeenCalledTimes(MAX_STALLED_CONNECTIONS);
			expect(h.stops).toEqual(['finished']);
		});
	});
});
