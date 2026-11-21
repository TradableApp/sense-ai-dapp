import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	IDLE_GIVE_UP_MS,
	MIN_RETRY_MS,
	startFrameStream,
	type StreamEvent,
	type StreamFetch,
	type StreamResponse,
} from './frameTransport';

const URL_42 = 'https://stream.example/stream/42';
const PROOF = 'zmsj4OksK8D2N9JMs__j2qRCsgSGomdTiRR9Dl6UUb4';
const RUN = '0123456789abcdef';

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

function start(responses: Array<StreamResponse | Error>): Harness {
	const queue = [...responses];
	const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
		const next = queue.shift() ?? ok([], { hold: true });
		if (next instanceof Error) throw next;
		// The request is aborted through its signal, as a real fetch is.
		if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
		return next;
	});
	const events: StreamEvent[] = [];
	const stops: string[] = [];
	const cursor = { value: null as string | null };
	const handle = startFrameStream({
		url: URL_42,
		proof: PROOF,
		// The cursor follows the frames received, as the reducer's does.
		onEvent: e => {
			events.push(e);
			cursor.value = e.id;
		},
		getCursor: () => cursor.value,
		onStop: reason => stops.push(reason),
		fetchImpl: fetchImpl as unknown as StreamFetch,
		random: () => 0,
	});
	return { fetchImpl, events, stops, cursor, handle };
}

const headersOf = (h: Harness, call: number) =>
	new Headers(h.fetchImpl.mock.calls[call][1].headers as HeadersInit);

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
		const { signal } = h.fetchImpl.mock.calls[0][1] as RequestInit;

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
});
