/**
 * Live reasoning stream: the dApp's half of the interface contract, version 1.
 *
 * The oracle keeps its own copy of these rules (`oracle/src/stream/streamContract.js`). The two
 * are held equal by the shared test vectors, one per frame type (`vector.testdata.ts` here; the
 * data file `test/fixtures/streamVectors.json`, checked by `streamContract.test.js`, there), and
 * both repos pin the same SHA-256 of their canonical form, so a change here is a change to both
 * repos at once, to the vectors and to the pinned hash.
 *
 * A frame is a small JSON object sealed with the prompt's session key, exactly as the stored
 * answer file is. There is no associated data in the seal, so after decrypting, the reader must
 * check that the frame names the answer it asked for and that its run and seq equal the SSE id
 * (`liveReducer.ts`): the key is one per wallet, and that check is what stops a frame of the
 * user's other answer being replayed into this one.
 */
import { z } from 'zod';

import safeHref from '@/lib/safeHref';

export const STREAM_CONTRACT_VERSION = 1;

export const FRAME_TYPES = Object.freeze({
	RESET: 'reset',
	SOURCES: 'sources',
	STEP: 'step',
	ATTEMPT: 'attempt',
	ANSWER: 'answer',
	DONE: 'done',
} as const);

export const RESET_REASONS = ['start', 'retry'] as const;
export const DONE_OUTCOMES = ['answered', 'abandoned', 'interrupted'] as const;
export type DoneOutcome = (typeof DONE_OUTCOMES)[number];

/** Every SSE event has this one name, so a proxy sees only lengths and timing. */
export const SSE_EVENT_NAME = 'frame';

/**
 * The oracle applies every limit before it builds a frame. `framePlaintextBytes` holds for every
 * frame but the `answer` frame, whose limit is `answerFramePlaintextBytes`: its text is up to
 * 64 KiB of UTF-8, which JSON escaping can grow six times (a control character is `\u00XX`), and
 * the rest of the frame is at most 429 bytes, so 6 x 64 KiB + 1 KiB bounds it. `answerCidChars`
 * bounds the content id an answer frame carries (the longest storage id today is 59 characters;
 * 128 also holds a base32 CIDv1 with a 512-bit hash), of the characters in `ANSWER_CID_PATTERN`.
 * A frame over its limit is refused: before decrypting when its sealed text is longer than
 * `MAX_SEALED_FRAME_CHARS` (`isSealedFrame`), and before parsing when its plaintext is over the
 * limit (`parseFrameBytes`). Refused frames are dropped and counted like any malformed frame.
 */
export const LIMITS = Object.freeze({
	maxSourcesPerFrame: 20,
	sourceTitleChars: 300,
	sourceUrlChars: 2048,
	stepTitleChars: 120,
	stepDescriptionChars: 4000,
	maxStepsPerAttempt: 64,
	maxAttempts: 4,
	answerTextBytes: 64 * 1024,
	framePlaintextBytes: 16 * 1024,
	answerFramePlaintextBytes: 6 * 64 * 1024 + 1024,
	answerCidChars: 128,
});

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const base64Chars = (bytes: number): number => 4 * Math.ceil(bytes / 3);

/**
 * The characters of a sealed frame whose plaintext is `plaintextBytes` long: base64 of the IV, a
 * dot, then base64 of the ciphertext with its tag appended (GCM adds no padding).
 */
export const sealedFrameChars = (plaintextBytes: number): number =>
	base64Chars(GCM_IV_BYTES) + 1 + base64Chars(plaintextBytes + GCM_TAG_BYTES);

/** The longest sealed frame the contract allows (an answer frame at its limit): 525,693. */
export const MAX_SEALED_FRAME_CHARS = sealedFrameChars(LIMITS.answerFramePlaintextBytes);

/** What a reader asks for and how. */
export const STREAM_HTTP = Object.freeze({
	streamPathPrefix: '/stream/',
	proofHeader: 'X-SenseAI-Stream-Proof',
	lastEventIdHeader: 'Last-Event-ID',
	/** The reconnect wait the server's `retry:` line names; used until the server says otherwise. */
	sseRetryMs: 2000,
});

/** The status of every refusal. The reader acts on the status alone, never on the body. */
export const STREAM_REFUSAL_STATUSES = Object.freeze({
	badRequest: 400,
	proof: 403,
	notOpen: 404,
	finished: 410,
	busy: 429,
	unavailable: 503,
});

/** The on-chain uint256 in decimal: no sign, no leading zeros, at most 78 digits. */
const ANSWER_MESSAGE_ID_PATTERN = /^(0|[1-9][0-9]{0,77})$/;
const RUN_PATTERN = /^[0-9a-f]{16}$/;
const REPLICA_PATTERN = /^[a-z0-9-]{1,32}$/;
const SSE_EVENT_ID_PATTERN = /^([0-9a-f]{16})\.(0|[1-9][0-9]{0,8})$/;
/** A content id: the base32 and base64url characters the storage ids use. */
const ANSWER_CID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${LIMITS.answerCidChars}}$`);
/** A sealed frame: base64 IV, a dot, base64 ciphertext. Never a line break. */
const SEALED_FRAME_PATTERN = /^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/;

export const isAnswerMessageId = (value: unknown): value is string =>
	typeof value === 'string' && ANSWER_MESSAGE_ID_PATTERN.test(value);

export const isReplica = (value: unknown): value is string =>
	typeof value === 'string' && REPLICA_PATTERN.test(value);

/** Sealed text in the contract's shape and no longer than the largest frame. */
export const isSealedFrame = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= MAX_SEALED_FRAME_CHARS &&
	SEALED_FRAME_PATTERN.test(value);

export interface SseEventId {
	run: string;
	seq: number;
}

/** `{ run, seq }` for a well-formed `<run>.<seq>`, otherwise null. */
export function parseSseEventId(text: unknown): SseEventId | null {
	if (typeof text !== 'string') return null;
	const match = SSE_EVENT_ID_PATTERN.exec(text);
	return match ? { run: match[1], seq: Number(match[2]) } : null;
}

export const sseEventId = (run: string, seq: number): string => `${run}.${seq}`;

export interface StreamEndpoint {
	url: string;
	mode: 'sse' | 'poll';
}

/** The stream of one answer. The id goes in the path; the proof never goes in a URL. */
export const streamUrl = (endpoint: StreamEndpoint, answerMessageId: string): string =>
	`${endpoint.url}${STREAM_HTTP.streamPathPrefix}${answerMessageId}${
		endpoint.mode === 'poll' ? '?mode=poll' : ''
	}`;

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The same rule the links use (`safeHref`), so a frame with any other scheme is refused whole. */
const isWebUrl = (value: string): boolean => safeHref(value) !== null;

const attempt = z.number().int().min(1).max(LIMITS.maxAttempts);

const source = z.object({
	title: z.string().min(1).max(LIMITS.sourceTitleChars),
	url: z.string().min(1).max(LIMITS.sourceUrlChars).refine(isWebUrl),
});

const identity = {
	v: z.literal(STREAM_CONTRACT_VERSION),
	answerMessageId: z.string().regex(ANSWER_MESSAGE_ID_PATTERN),
	run: z.string().regex(RUN_PATTERN),
	seq: z.number().int().min(0),
	replica: z.string().regex(REPLICA_PATTERN),
};

const frameSchema = z.discriminatedUnion('type', [
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.RESET),
		data: z.object({ reason: z.enum(RESET_REASONS) }),
	}),
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.SOURCES),
		data: z.object({ attempt, sources: z.array(source).max(LIMITS.maxSourcesPerFrame) }),
	}),
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.STEP),
		data: z.object({
			attempt,
			title: z.string().min(1).max(LIMITS.stepTitleChars),
			description: z.string().min(1).max(LIMITS.stepDescriptionChars),
		}),
	}),
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.ATTEMPT),
		data: z.object({ attempt: attempt.min(2) }),
	}),
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.ANSWER),
		data: z.object({
			text: z.string().refine(text => utf8Bytes(text) <= LIMITS.answerTextBytes),
			answerMessageCID: z.string().regex(ANSWER_CID_PATTERN),
			reasoningDuration: z.number().finite().optional(),
		}),
	}),
	z.object({
		...identity,
		type: z.literal(FRAME_TYPES.DONE),
		data: z.object({ outcome: z.enum(DONE_OUTCOMES) }),
	}),
]);

export type Frame = z.infer<typeof frameSchema>;
export type StepFrame = Extract<Frame, { type: 'step' }>;

/** The frame, when the decrypted value is one in the contract's shape; otherwise null. */
export function parseFramePlaintext(value: unknown): Frame | null {
	const result = frameSchema.safeParse(value);
	return result.success ? result.data : null;
}

/**
 * The frame, when the decrypted bytes are one within its size limit and in the contract's shape;
 * otherwise null. Nothing over the answer frame limit is decoded or parsed. Never throws.
 */
export function parseFrameBytes(bytes: Uint8Array): Frame | null {
	if (bytes.length > LIMITS.answerFramePlaintextBytes) return null;
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		return null;
	}
	const frame = parseFramePlaintext(value);
	if (!frame) return null;
	if (frame.type !== FRAME_TYPES.ANSWER && bytes.length > LIMITS.framePlaintextBytes) return null;
	return frame;
}
