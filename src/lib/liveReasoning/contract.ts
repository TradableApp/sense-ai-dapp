/**
 * Live reasoning stream: the dApp's half of the interface contract, version 1.
 *
 * The oracle keeps its own copy of these rules (`oracle/src/stream/streamContract.js`). The two
 * are held equal by the shared test vector (`vector.testdata.ts` here, `streamContract.test.js`
 * there), so a change here is a change to both repos at once.
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
});

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
/** A sealed frame: base64 IV, a dot, base64 ciphertext. Never a line break. */
const SEALED_FRAME_PATTERN = /^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/;

export const isAnswerMessageId = (value: unknown): value is string =>
	typeof value === 'string' && ANSWER_MESSAGE_ID_PATTERN.test(value);

export const isReplica = (value: unknown): value is string =>
	typeof value === 'string' && REPLICA_PATTERN.test(value);

export const isSealedFrame = (value: unknown): value is string =>
	typeof value === 'string' && SEALED_FRAME_PATTERN.test(value);

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
			answerMessageCID: z.string().min(1),
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
