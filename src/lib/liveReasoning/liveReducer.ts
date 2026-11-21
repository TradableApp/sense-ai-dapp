/**
 * What is shown live for one answer, folded from its frames. Pure: every call returns a new
 * state and an effect for the caller to carry out; nothing is read or written elsewhere.
 *
 * Rules (contract 1.7): frames apply in seq order; a duplicate (run, seq) is ignored; a frame
 * after a gap is held (at most `MAX_HELD_FRAMES`) and, if the gap is not filled within
 * `GAP_WAIT_MS`, the caller reconnects from the last frame applied in order. A frame of
 * another run is taken only when it is that run's seq-0 reset, which clears everything shown;
 * anything else from another run is dropped and the caller reconnects with no cursor. A frame
 * that names another answer, or whose run and seq differ from its SSE id, is dropped: the
 * session key is one per wallet, so this check is what keeps one answer's frames out of another.
 */
import {
	type DoneOutcome,
	type Frame,
	FRAME_TYPES,
	LIMITS,
	type SseEventId,
	sseEventId,
} from '@/lib/liveReasoning/contract';

/** How long a gap may stay open before the caller reconnects from the cursor. */
export const GAP_WAIT_MS = 5_000;
/** The most frames held after a gap before the caller reconnects at once. */
export const MAX_HELD_FRAMES = 64;

export interface LiveStep {
	title: string;
	description: string;
	attempt: number;
}

export interface LiveSource {
	title: string;
	url: string;
	attempt: number;
}

export interface LiveAnswer {
	text: string;
	answerMessageCID: string;
	reasoningDuration?: number;
}

export interface LiveAnswerState {
	answerMessageId: string;
	run: string | null;
	replica: string | null;
	/** The seq the current run expects next. */
	nextSeq: number;
	/** Frames after a gap, in seq order. */
	held: readonly Frame[];
	gapSince: number | null;
	attempt: number;
	steps: readonly LiveStep[];
	sources: readonly LiveSource[];
	answer: LiveAnswer | null;
	outcome: DoneOutcome | null;
	/** Frames refused: undecryptable, outside the schema, or not for this answer and run. */
	dropped: number;
}

export type ReducerEffect = 'none' | 'reconnect-fresh' | 'reconnect-from-cursor';

export interface ReduceResult {
	state: LiveAnswerState;
	effect: ReducerEffect;
}

const SHOWN_NOTHING = {
	attempt: 1,
	steps: [],
	sources: [],
	answer: null,
	outcome: null,
} as const;

export const initialLiveState = (answerMessageId: string): LiveAnswerState => ({
	answerMessageId,
	run: null,
	replica: null,
	nextSeq: 0,
	held: [],
	gapSince: null,
	dropped: 0,
	...SHOWN_NOTHING,
});

const result = (state: LiveAnswerState, effect: ReducerEffect = 'none'): ReduceResult => ({
	state,
	effect,
});

export const dropFrame = (state: LiveAnswerState): LiveAnswerState => ({
	...state,
	dropped: state.dropped + 1,
});

/** `<run>.<seq>` of the last frame applied in order, for `Last-Event-ID`; null before any. */
export const cursorOf = (state: LiveAnswerState): string | null =>
	state.run !== null && state.nextSeq > 0 ? sseEventId(state.run, state.nextSeq - 1) : null;

const stepsInAttempt = (state: LiveAnswerState, attempt: number) =>
	state.steps.filter(step => step.attempt === attempt).length;

/** Applies the frame that is next in seq order. */
function applyInOrder(state: LiveAnswerState, frame: Frame): LiveAnswerState {
	const next = { ...state, nextSeq: state.nextSeq + 1, replica: frame.replica };
	switch (frame.type) {
		case FRAME_TYPES.SOURCES:
			return {
				...next,
				sources: [
					...state.sources,
					...frame.data.sources.map(s => ({ title: s.title, url: s.url, attempt: frame.data.attempt })),
				],
			};
		case FRAME_TYPES.STEP: {
			const { attempt, title, description } = frame.data;
			if (stepsInAttempt(state, attempt) >= LIMITS.maxStepsPerAttempt) return next;
			return { ...next, steps: [...state.steps, { title, description, attempt }] };
		}
		case FRAME_TYPES.ATTEMPT:
			return { ...next, attempt: Math.max(state.attempt, frame.data.attempt) };
		case FRAME_TYPES.ANSWER:
			return { ...next, answer: { ...frame.data } };
		case FRAME_TYPES.DONE:
			return frame.data.outcome === 'abandoned'
				? { ...next, ...SHOWN_NOTHING, outcome: 'abandoned' }
				: { ...next, outcome: frame.data.outcome };
		default:
			// A reset after seq 0 is outside the contract; it moves the cursor and changes nothing.
			return next;
	}
}

/** Applies held frames that have become next in order. */
function drainHeld(state: LiveAnswerState): LiveAnswerState {
	const [first, ...rest] = state.held;
	if (!first || first.seq !== state.nextSeq) {
		return state.held.length === 0 ? { ...state, gapSince: null } : state;
	}
	return drainHeld({ ...applyInOrder(state, first), held: rest });
}

function hold(state: LiveAnswerState, frame: Frame, now: number): ReduceResult {
	if (state.held.some(held => held.seq === frame.seq)) return result(state);
	if (state.held.length >= MAX_HELD_FRAMES) {
		return result({ ...state, held: [], gapSince: null }, 'reconnect-from-cursor');
	}
	const held = [...state.held, frame].sort((a, b) => a.seq - b.seq);
	return result({ ...state, held, gapSince: state.gapSince ?? now });
}

const isNewRunReset = (frame: Frame) => frame.seq === 0 && frame.type === FRAME_TYPES.RESET;

/**
 * Folds one decrypted, schema-checked frame into the state. `eventId` is the SSE id it came
 * with; `now` is the caller's clock, used only to time a gap.
 */
export function applyFrame(
	state: LiveAnswerState,
	frame: Frame,
	eventId: SseEventId,
	now: number,
): ReduceResult {
	if (
		frame.answerMessageId !== state.answerMessageId ||
		frame.run !== eventId.run ||
		frame.seq !== eventId.seq
	) {
		return result(dropFrame(state));
	}
	if (frame.run !== state.run) {
		if (!isNewRunReset(frame)) return result(dropFrame(state), 'reconnect-fresh');
		return result({
			...initialLiveState(state.answerMessageId),
			dropped: state.dropped,
			run: frame.run,
			replica: frame.replica,
			nextSeq: 1,
		});
	}
	if (frame.seq < state.nextSeq) return result(state);
	if (frame.seq > state.nextSeq) return hold(state, frame, now);
	return result(drainHeld(applyInOrder(state, frame)));
}

/** Gives up on a gap open for `GAP_WAIT_MS` or more: the caller reconnects from the cursor. */
export function checkGap(state: LiveAnswerState, now: number): ReduceResult {
	if (state.gapSince === null || now - state.gapSince < GAP_WAIT_MS) return result(state);
	return result({ ...state, held: [], gapSince: null }, 'reconnect-from-cursor');
}
