/**
 * The connection to one answer's reasoning stream: a `fetch()` stream reader, because the proof
 * of key travels in a request header and native `EventSource` cannot send one. It parses the
 * server-sent events, reconnects with `Last-Event-ID`, and acts on the response status alone.
 *
 *   200          read `frame` events until the server ends the response, then reconnect: at
 *                once when the cursor moved, or when nothing came and the response had been
 *                open `HELD_OPEN_MS` (the server ended it at its lifetime); after the server's
 *                `retry:` when nothing came and it ended sooner; with the backoff when something came and the cursor did not move, and after
 *                `MAX_STALLED_CONNECTIONS` such connections in a row, stop as `finished`
 *   404/429/503  retry after `Retry-After` (never sooner than `MIN_RETRY_MS`)
 *   400/403/410  stop for good (`bad-request`, `proof-refused`, `finished`)
 *   other, or a network failure: retry with the shared jittered backoff from `MIN_RETRY_MS`
 *                (a response cut after `HELD_OPEN_MS` open starts that backoff again)
 *
 * Progress is the cursor moving, never a frame merely arriving: a frame that cannot be applied
 * is replayed by the server on every connection. A response is judged once every frame it
 * delivered has been applied or dropped (decryption is asynchronous). Frames are handed on one
 * at a time, each once the one before has settled, and the next chunk is read only then, so a
 * response cannot queue work faster than it is done. A response is also ended, and counted as
 * stalled, while it is still open: after `MAX_REFUSED_FRAMES_PER_CONNECTION` refused frames, or
 * once a frame it delivered moved the cursor nowhere and the cursor has then not moved for
 * `STALLED_RESPONSE_MS`. Reading is linear in what arrives: each chunk is scanned once for line
 * ends, and an event holds at most `MAX_DATA_LINES_PER_EVENT` data lines. It gives up when the
 * cursor has not moved for `IDLE_GIVE_UP_MS`. While the tab is hidden (`isHidden`) no connection
 * is opened and the idle wait is paused; `wake` resumes from the cursor. The proof is put in the header and nowhere else:
 * not in the URL, a log line or a report. Only `useLiveReasoning` starts it (the
 * `live-reasoning-ephemeral` guard).
 */
import { backoffDelayMs } from '@/lib/backoff';
import {
	MAX_SEALED_FRAME_CHARS,
	SSE_EVENT_NAME,
	STREAM_HTTP,
	STREAM_REFUSAL_STATUSES,
} from '@/lib/liveReasoning/contract';

/** The shortest wait before any retry, whatever the server says. */
export const MIN_RETRY_MS = 1_000;
/**
 * A response open at least this long was held by the server, not ended early: a quiet one is
 * followed at once, since a frame made during the `retry:` wait would be shown that much late,
 * and one a proxy cut is no failing server, so the backoff starts again from its first step.
 * Either way at most one request is made per this long. Below the server's poll wait (20 s) and
 * any connection lifetime it is given.
 */
export const HELD_OPEN_MS = 10_000;
/** No progress for this long and the stream is given up; the stored answer still lands by sync. */
export const IDLE_GIVE_UP_MS = 10 * 60 * 1000;
/**
 * A line longer than this is not a frame: `data: ` and the longest sealed frame the contract
 * allows (an answer frame at its plaintext limit, 525,693 characters).
 */
export const MAX_LINE_CHARS = 'data: '.length + MAX_SEALED_FRAME_CHARS;
/** The most `data:` an event may join (each line counted with its joining newline). */
export const MAX_EVENT_CHARS = MAX_SEALED_FRAME_CHARS + 1;
/** A sealed frame is one line (base64 and a dot): an event with a second data line is no frame. */
export const MAX_DATA_LINES_PER_EVENT = 1;
/**
 * Frames one connection may deliver that are refused (undecryptable, outside the schema, or for
 * another answer or run) before it is ended and counted as stalled. A genuine server sends none.
 */
export const MAX_REFUSED_FRAMES_PER_CONNECTION = 8;
/**
 * How long a response that is still open may go without moving the cursor, once a frame it
 * delivered moved it nowhere, before it is ended and counted as stalled. A response that brings
 * only heartbeats is not judged by it: the server sets that pace.
 */
export const STALLED_RESPONSE_MS = 60_000;
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

/** What became of a frame handed on: taken by the reducer (applied, held or a duplicate), or refused. */
export type FrameVerdict = 'applied' | 'refused';

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
	/**
	 * Settles once the event has been applied or dropped, when that does not happen at once, with
	 * `'refused'` for a frame that was dropped (counted against `MAX_REFUSED_FRAMES_PER_CONNECTION`).
	 */
	onEvent: (_event: StreamEvent) => void | FrameVerdict | Promise<unknown>;
	/** The last frame applied in order, read at each connection and to measure progress. */
	getCursor: () => string | null;
	onStop: (_reason: StopReason) => void;
	fetchImpl?: StreamFetch;
	random?: () => number;
	/** Whether the tab is hidden: no connection is opened then, and the idle wait is paused. */
	isHidden?: () => boolean;
}

export interface FrameStreamHandle {
	stop(): void;
	/** Drops the open connection and opens another (on the wake, while hidden), with no cursor when `fresh`. */
	reconnect(_fresh: boolean): void;
	/** The tab is shown again: connects from the cursor if a connection was skipped while hidden. */
	wake(): void;
}

type ConnectionOutcome =
	| { kind: 'ended'; sawEvents: boolean; malformed: boolean; held: boolean }
	| { kind: 'retry'; afterMs: number | null; held: boolean }
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

/** The body is not a stream of events this reader takes (a line or an event too long to be a frame). */
class MalformedStreamError extends Error {}

interface SseParser {
	push(_text: string): void;
}

/** Server-sent events, field by field (the WHATWG rules the stream uses: id, event, data, retry). */
function createSseParser(
	onEvent: (_e: StreamEvent) => void,
	onRetry: (_ms: number) => void,
): SseParser {
	// The line still arriving, in the pieces it came in: joined once, when its end arrives.
	let pieces: string[] = [];
	let pieceChars = 0;
	// The last chunk ended on a CR: a LF at the start of the next is the rest of that line end.
	let afterCr = false;
	let id: string | null = null;
	let name = '';
	let data: string[] = [];
	let dataChars = 0;

	const emitEvent = () => {
		if (name === SSE_EVENT_NAME && id !== null && data.length > 0) {
			onEvent({ id, data: data.join('\n') });
		}
		id = null;
		name = '';
		data = [];
		dataChars = 0;
	};

	const addData = (value: string) => {
		dataChars += value.length + 1;
		if (data.length >= MAX_DATA_LINES_PER_EVENT || dataChars > MAX_EVENT_CHARS) {
			throw new MalformedStreamError();
		}
		data.push(value);
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
		else if (key === 'data') addData(value);
		else if (key === 'retry' && /^\d+$/.test(value)) onRetry(Number(value));
		return undefined;
	};

	return {
		// Each chunk is scanned once, from where the last line end in it was found: what is
		// pending is never scanned or copied again, so reading is linear in what arrives.
		push(text) {
			if (text === '') return;
			let from = afterCr && text.startsWith('\n') ? 1 : 0;
			afterCr = false;
			const lineEnd = /\r\n|\r|\n/g;
			lineEnd.lastIndex = from;
			for (let match = lineEnd.exec(text); match !== null; match = lineEnd.exec(text)) {
				const piece = text.slice(from, match.index);
				// A line that arrived whole is held to the same cap, so a chunk boundary changes nothing.
				if (pieceChars + piece.length > MAX_LINE_CHARS) throw new MalformedStreamError();
				const line = pieces.length === 0 ? piece : pieces.join('') + piece;
				pieces = [];
				pieceChars = 0;
				from = lineEnd.lastIndex;
				// A CR that ends the chunk may be the first half of a CRLF still to come.
				afterCr = match[0] === '\r' && from === text.length;
				field(line);
			}
			if (from < text.length) {
				pieceChars += text.length - from;
				if (pieceChars > MAX_LINE_CHARS) throw new MalformedStreamError();
				pieces.push(text.slice(from));
			}
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
	/** Settles once every frame handed on so far has been applied or dropped. */
	settled: () => Promise<unknown>;
	/** Rejects with `MalformedStreamError` when the connection is to be ended as stalled. */
	stalled: Promise<never>;
}

async function readBody(
	stream: ReadableStream<Uint8Array>,
	parser: SseParser,
	{ settled, stalled }: Pick<ReadOptions, 'settled' | 'stalled'>,
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		// A loop, not a recursive pump: each call of that waited on the next until the body
		// ended, a chain of pending calls as long as the connection.
		for (;;) {
			// eslint-disable-next-line no-await-in-loop -- each read follows the one before
			const { done, value } = await Promise.race([reader.read(), stalled]);
			if (done) return;
			parser.push(decoder.decode(value, { stream: true }));
			// The next chunk is read once this one's frames are done with: no queue builds up.
			// eslint-disable-next-line no-await-in-loop -- each chunk waits for the one before
			await Promise.race([settled(), stalled]);
		}
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
	let openedAt: number | null = null;
	/** Whether the 200 response has been open `HELD_OPEN_MS`. */
	const held = () => openedAt !== null && Date.now() - openedAt >= HELD_OPEN_MS;
	try {
		const response = await options.fetchImpl(options.url, {
			method: 'GET',
			headers,
			signal: options.signal,
			cache: 'no-store',
			credentials: 'omit',
			mode: 'cors',
			referrerPolicy: 'no-referrer',
			// A redirect would carry the proof header to wherever it points.
			redirect: 'error',
		});
		if (response.status !== 200) discardBody(response);
		if (STOPS[response.status]) return { kind: 'stop', reason: STOPS[response.status] };
		if (RETRY_AFTER_STATUSES.has(response.status)) {
			return { kind: 'retry', afterMs: retryAfterMs(response), held: false };
		}
		if (response.status !== 200 || !response.body) {
			return { kind: 'retry', afterMs: null, held: false };
		}
		openedAt = Date.now();
		const parser = createSseParser(event => {
			sawEvents = true;
			options.onEvent(event);
		}, options.onRetry);
		await readBody(response.body, parser, options);
		return { kind: 'ended', sawEvents, malformed: false, held: held() };
	} catch (error) {
		if (options.signal.aborted) return { kind: 'aborted' };
		const malformed = error instanceof MalformedStreamError;
		return sawEvents || malformed
			? { kind: 'ended', sawEvents, malformed, held: held() }
			: { kind: 'retry', afterMs: null, held: held() };
	}
}

/** Opens the stream and keeps it open until stopped, refused for good, stalled or idle. */
export function startFrameStream(options: FrameStreamOptions): FrameStreamHandle {
	const fetchImpl: StreamFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
	const random = options.random ?? Math.random;
	const isHidden = options.isHidden ?? (() => false);
	let stopped = false;
	let pausedWhileHidden = false;
	let generation = 0;
	let failures = 0;
	let stalled = 0;
	let progressCursor: string | null = null;
	let freshNext = false;
	let retryMs: number = STREAM_HTTP.sseRetryMs;
	let controller: AbortController | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	// The open connection's stall wait (one connection at a time).
	let stallTimer: ReturnType<typeof setTimeout> | null = null;

	const clearStallTimer = () => {
		if (stallTimer) clearTimeout(stallTimer);
		stallTimer = null;
	};

	const clearTimers = () => {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (idleTimer) clearTimeout(idleTimer);
		reconnectTimer = null;
		idleTimer = null;
		clearStallTimer();
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

	/** Starts the idle wait again when the cursor has moved since it last did. */
	const noteProgress = () => {
		if (stopped) return;
		const cursor = options.getCursor();
		if (cursor === null || cursor === progressCursor) return;
		progressCursor = cursor;
		armIdle();
	};

	const backoff = () => {
		failures += 1;
		return backoffDelayMs(failures - 1, MIN_RETRY_MS, random);
	};

	// Declared before use by `schedule`; `connect` and `schedule` call each other.
	let connect: () => Promise<void> = async () => undefined;

	/** Connects, unless the tab is hidden: then nothing is asked and nothing goes idle. */
	const connectUnlessHidden = () => {
		if (!isHidden()) {
			connect();
			return;
		}
		pausedWhileHidden = true;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = null;
	};

	const schedule = (delayMs: number) => {
		if (stopped) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connectUnlessHidden();
		}, delayMs);
	};

	/** The wait before the next connection, null for none, or `give-up`. */
	const delayAfter = (
		outcome: ConnectionOutcome,
		progressed: boolean,
	): number | null | 'give-up' => {
		switch (outcome.kind) {
			case 'ended':
				if (progressed) {
					failures = 0;
					stalled = 0;
					return 0;
				}
				if (!outcome.sawEvents && !outcome.malformed) {
					// Nothing came (a quiet poll, a heartbeat-only response). One the server held open
					// is followed at once; one it ended sooner waits the pace the server set.
					if (!outcome.held) return retryMs;
					failures = 0;
					return 0;
				}
				stalled += 1;
				return stalled >= MAX_STALLED_CONNECTIONS ? 'give-up' : backoff();
			case 'retry':
				if (outcome.afterMs !== null) return Math.max(outcome.afterMs, MIN_RETRY_MS);
				// A response cut after it was held open is not a failing server.
				if (outcome.held) failures = 0;
				return backoff();
			default:
				return null;
		}
	};

	connect = async () => {
		generation += 1;
		const mine = generation;
		clearStallTimer();
		controller = new AbortController();
		const cursorAtStart = options.getCursor();
		const lastEventId = freshNext ? null : cursorAtStart;
		freshNext = false;
		const current = () => !stopped && mine === generation;
		let applying: Promise<unknown> = Promise.resolve();
		let refused = 0;
		let endAsStalled: () => void = () => undefined;
		const endedAsStalled = new Promise<never>((_resolve, reject) => {
			endAsStalled = () => reject(new MalformedStreamError());
		});
		// Rejected only to end the read; nothing else waits on it.
		endedAsStalled.catch(() => undefined);

		/** Hands one frame on and judges what it did, once the one before has settled. */
		const handOn = async (event: StreamEvent) => {
			// Past the cap the rest of the response is skipped: it is about to be ended.
			if (!current() || refused >= MAX_REFUSED_FRAMES_PER_CONNECTION) return;
			const before = options.getCursor();
			const verdict = await Promise.resolve()
				.then(() => options.onEvent(event))
				.catch(() => undefined);
			noteProgress();
			if (!current()) return;
			if (verdict === 'refused') {
				refused += 1;
				if (refused >= MAX_REFUSED_FRAMES_PER_CONNECTION) endAsStalled();
			}
			if (options.getCursor() !== before) clearStallTimer();
			else if (!stallTimer) stallTimer = setTimeout(endAsStalled, STALLED_RESPONSE_MS);
		};

		const outcome = await readConnection({
			url: options.url,
			proof: options.proof,
			lastEventId,
			signal: controller.signal,
			fetchImpl,
			onEvent: event => {
				if (!current()) return;
				applying = applying.then(() => handOn(event)).catch(() => undefined);
			},
			onRetry: ms => {
				retryMs = Math.max(ms, MIN_RETRY_MS);
			},
			settled: () => applying,
			stalled: endedAsStalled,
		});
		await applying;
		if (!current()) return;
		clearStallTimer();
		if (outcome.kind === 'stop') {
			finish(outcome.reason);
			return;
		}
		const cursorNow = options.getCursor();
		const delay = delayAfter(outcome, cursorNow !== null && cursorNow !== cursorAtStart);
		if (delay === 'give-up') finish('finished');
		else if (delay !== null) schedule(delay);
	};

	armIdle();
	connectUnlessHidden();

	return {
		stop,
		reconnect(fresh) {
			if (stopped) return;
			freshNext = fresh;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			controller?.abort();
			// While hidden this is made on the wake, from the cursor (or fresh, as asked).
			connectUnlessHidden();
		},
		wake() {
			if (stopped || !pausedWhileHidden || isHidden()) return;
			pausedWhileHidden = false;
			// One open request at a time: whatever is scheduled or open is replaced by this one.
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			controller?.abort();
			armIdle();
			connect();
		},
	};
}
