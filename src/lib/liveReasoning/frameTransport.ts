/**
 * The connection to one answer's reasoning stream: a `fetch()` stream reader, because the proof
 * of key travels in a request header and native `EventSource` cannot send one. It parses the
 * server-sent events, reconnects with `Last-Event-ID`, and acts on the response status alone.
 *
 *   200          read `frame` events until the server ends the response, then reconnect
 *   404/429/503  retry after `Retry-After` (never sooner than `MIN_RETRY_MS`)
 *   400/403/410  stop for good (`bad-request`, `proof-refused`, `finished`)
 *   other, or a network failure: retry with the shared jittered backoff from `MIN_RETRY_MS`
 *
 * It gives up when no frame has arrived for `IDLE_GIVE_UP_MS`. The proof is put in the header and
 * nowhere else: not in the URL, a log line or a report. Only `useLiveReasoning` starts it (the
 * `live-reasoning-ephemeral` guard).
 */
import { backoffDelayMs } from '@/lib/backoff';
import { SSE_EVENT_NAME, STREAM_HTTP, STREAM_REFUSAL_STATUSES } from '@/lib/liveReasoning/contract';

/** The shortest wait before any retry, whatever the server says. */
export const MIN_RETRY_MS = 1_000;
/** No frame for this long and the stream is given up; the stored answer still lands by sync. */
export const IDLE_GIVE_UP_MS = 10 * 60 * 1000;
/** A line longer than this is not a frame (an answer frame is under 100 KiB once sealed). */
export const MAX_LINE_CHARS = 256 * 1024;
/**
 * Connections in a row that delivered something but moved the cursor nowhere (a frame that
 * cannot be applied, which the server replays each time, or a line too long to be a frame)
 * before the stream is given up as `finished`.
 */
export const MAX_STALLED_CONNECTIONS = 5;

export interface StreamEvent {
	id: string;
	data: string;
}

export type StopReason = 'bad-request' | 'proof-refused' | 'finished' | 'idle';

/** The slice of a fetch `Response` the reader uses. */
export interface StreamResponse {
	status: number;
	headers: { get(_name: string): string | null };
	body: ReadableStream<Uint8Array> | null;
}

/** The options a fetch takes, named without the DOM lib's global type. */
export type StreamRequestInit = NonNullable<Parameters<typeof fetch>[1]>;

export type StreamFetch = (_url: string, _init: StreamRequestInit) => Promise<StreamResponse>;

export interface FrameStreamOptions {
	url: string;
	proof: string;
	onEvent: (_event: StreamEvent) => void;
	/** The last frame applied in order, read at each connection. */
	getCursor: () => string | null;
	onStop: (_reason: StopReason) => void;
	fetchImpl?: StreamFetch;
	random?: () => number;
}

export interface FrameStreamHandle {
	stop(): void;
	/** Drops the open connection and opens another, with no cursor when `fresh`. */
	reconnect(_fresh: boolean): void;
}

type ConnectionOutcome =
	| { kind: 'ended'; sawEvents: boolean }
	| { kind: 'retry'; afterMs: number | null }
	| { kind: 'stop'; reason: Exclude<StopReason, 'idle'> }
	| { kind: 'aborted' };

const STOPS: Record<number, Exclude<StopReason, 'idle'>> = {
	[STREAM_REFUSAL_STATUSES.badRequest]: 'bad-request',
	[STREAM_REFUSAL_STATUSES.proof]: 'proof-refused',
	[STREAM_REFUSAL_STATUSES.finished]: 'finished',
};

const RETRY_AFTER_STATUSES = new Set<number>([
	STREAM_REFUSAL_STATUSES.notOpen,
	STREAM_REFUSAL_STATUSES.busy,
	STREAM_REFUSAL_STATUSES.unavailable,
]);

/** Retry-After in whole seconds, as the server sends it; anything else means "use the backoff". */
function retryAfterMs(response: StreamResponse): number | null {
	const value = response.headers.get('Retry-After');
	return value !== null && /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) * 1000 : null;
}

interface SseParser {
	push(_text: string): void;
}

/** Server-sent events, field by field (the WHATWG rules the stream uses: id, event, data, retry). */
function createSseParser(
	onEvent: (_e: StreamEvent) => void,
	onRetry: (_ms: number) => void,
): SseParser {
	let buffer = '';
	let id: string | null = null;
	let name = '';
	let data: string[] = [];

	const emitEvent = () => {
		if (name === SSE_EVENT_NAME && id !== null && data.length > 0) {
			onEvent({ id, data: data.join('\n') });
		}
		id = null;
		name = '';
		data = [];
	};

	const field = (line: string) => {
		if (line === '') return emitEvent();
		if (line.startsWith(':')) return undefined;
		const colon = line.indexOf(':');
		const key = colon === -1 ? line : line.slice(0, colon);
		const raw = colon === -1 ? '' : line.slice(colon + 1);
		const value = raw.startsWith(' ') ? raw.slice(1) : raw;
		if (key === 'id') id = value;
		else if (key === 'event') name = value;
		else if (key === 'data') data = [...data, value];
		else if (key === 'retry' && /^\d+$/.test(value)) onRetry(Number(value));
		return undefined;
	};

	return {
		push(text) {
			buffer += text;
			// A trailing CR may be the first half of a CRLF still to come: keep it for the next chunk.
			const end = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
			const lines = buffer.slice(0, end).split(/\r\n|\r|\n/);
			buffer = (lines.pop() ?? '') + buffer.slice(end);
			if (buffer.length > MAX_LINE_CHARS) throw new RangeError('An event line is too long.');
			lines.forEach(field);
		},
	};
}

interface ReadOptions {
	url: string;
	proof: string;
	lastEventId: string | null;
	signal: AbortSignal;
	fetchImpl: StreamFetch;
	onEvent: (_e: StreamEvent) => void;
	onRetry: (_ms: number) => void;
}

async function readBody(stream: ReadableStream<Uint8Array>, parser: SseParser) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const pump = async (): Promise<void> => {
		const { done, value } = await reader.read();
		if (done) return;
		parser.push(decoder.decode(value, { stream: true }));
		await pump();
	};
	try {
		await pump();
	} finally {
		reader.cancel().catch(() => undefined);
	}
}

/**
 * A refusal is acted on by its status alone, but its body still has to be let go: left unread,
 * the request stays open and holds its connection.
 */
function discardBody(response: StreamResponse): void {
	try {
		response.body?.cancel().catch(() => undefined);
	} catch {
		// A body that cannot be cancelled is dropped with the response.
	}
}

/** One connection, from request to the end of the response. Never throws. */
async function readConnection(options: ReadOptions): Promise<ConnectionOutcome> {
	const headers: Record<string, string> = {
		Accept: 'text/event-stream',
		[STREAM_HTTP.proofHeader]: options.proof,
	};
	if (options.lastEventId) headers[STREAM_HTTP.lastEventIdHeader] = options.lastEventId;
	let sawEvents = false;
	try {
		const response = await options.fetchImpl(options.url, {
			method: 'GET',
			headers,
			signal: options.signal,
			cache: 'no-store',
			credentials: 'omit',
			mode: 'cors',
			referrerPolicy: 'no-referrer',
		});
		if (response.status !== 200) discardBody(response);
		if (STOPS[response.status]) return { kind: 'stop', reason: STOPS[response.status] };
		if (RETRY_AFTER_STATUSES.has(response.status)) {
			return { kind: 'retry', afterMs: retryAfterMs(response) };
		}
		if (response.status !== 200 || !response.body) return { kind: 'retry', afterMs: null };
		const parser = createSseParser(event => {
			sawEvents = true;
			options.onEvent(event);
		}, options.onRetry);
		await readBody(response.body, parser);
		return { kind: 'ended', sawEvents };
	} catch {
		if (options.signal.aborted) return { kind: 'aborted' };
		return sawEvents ? { kind: 'ended', sawEvents } : { kind: 'retry', afterMs: null };
	}
}

/** Opens the stream and keeps it open until stopped, refused for good or idle. */
export function startFrameStream(options: FrameStreamOptions): FrameStreamHandle {
	const fetchImpl: StreamFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
	const random = options.random ?? Math.random;
	let stopped = false;
	let generation = 0;
	let failures = 0;
	let freshNext = false;
	let retryMs: number = STREAM_HTTP.sseRetryMs;
	let controller: AbortController | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	const clearTimers = () => {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (idleTimer) clearTimeout(idleTimer);
		reconnectTimer = null;
		idleTimer = null;
	};

	const stop = () => {
		stopped = true;
		generation += 1;
		clearTimers();
		controller?.abort();
	};

	const finish = (reason: StopReason) => {
		if (stopped) return;
		stop();
		options.onStop(reason);
	};

	const armIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => finish('idle'), IDLE_GIVE_UP_MS);
	};

	// Declared before use by `schedule`; `connect` and `schedule` call each other.
	let connect: () => Promise<void> = async () => undefined;

	const schedule = (delayMs: number) => {
		if (stopped) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delayMs);
	};

	const delayAfter = (outcome: ConnectionOutcome): number | null => {
		switch (outcome.kind) {
			case 'ended':
				if (outcome.sawEvents) failures = 0;
				return outcome.sawEvents ? 0 : retryMs;
			case 'retry':
				if (outcome.afterMs !== null) return Math.max(outcome.afterMs, MIN_RETRY_MS);
				failures += 1;
				return backoffDelayMs(failures - 1, MIN_RETRY_MS, random);
			default:
				return null;
		}
	};

	connect = async () => {
		generation += 1;
		const mine = generation;
		controller = new AbortController();
		const lastEventId = freshNext ? null : options.getCursor();
		freshNext = false;
		const outcome = await readConnection({
			url: options.url,
			proof: options.proof,
			lastEventId,
			signal: controller.signal,
			fetchImpl,
			onEvent: event => {
				if (stopped || mine !== generation) return;
				armIdle();
				options.onEvent(event);
			},
			onRetry: ms => {
				retryMs = Math.max(ms, MIN_RETRY_MS);
			},
		});
		if (stopped || mine !== generation) return;
		if (outcome.kind === 'stop') {
			finish(outcome.reason);
			return;
		}
		const delay = delayAfter(outcome);
		if (delay !== null) schedule(delay);
	};

	armIdle();
	connect();

	return {
		stop,
		reconnect(fresh) {
			if (stopped) return;
			freshNext = fresh;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			controller?.abort();
			connect();
		},
	};
}
