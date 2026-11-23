/**
 * The live view of one awaited answer: proof, connection, decryption, schema, reducer. Each
 * frame is decrypted and folded in the order it arrived (a queue, since Web Crypto is
 * asynchronous). A frame that is longer than the largest frame, cannot be decrypted, is over its
 * plaintext limit (checked before parsing), is outside the schema, or names another answer or run
 * is dropped and counted, and never shown. Nothing here logs: a failure is
 * counted in the state, and a refusal that can never pass is reported by kind only.
 *
 * The state is published (`onState`) only when something shown changed: a dropped frame, a
 * duplicate or a frame held after a gap re-renders nothing, so a stream of junk cannot make the
 * chat render once per frame. The transport is told which frames were refused, and ends a
 * connection that sends too many.
 *
 * The connection is passed in (`startStream`) so that only `useLiveReasoning` names the
 * transport (the `live-reasoning-ephemeral` guard).
 */
import { decryptBytes } from '@/lib/crypto';
import {
	isSealedFrame,
	parseFrameBytes,
	parseSseEventId,
	type StreamEndpoint,
	streamUrl,
} from '@/lib/liveReasoning/contract';
import type {
	FrameStreamHandle,
	FrameStreamOptions,
	FrameVerdict,
	StopReason,
	StreamEvent,
} from '@/lib/liveReasoning/frameTransport';
import {
	applyFrame,
	checkGap,
	cursorOf,
	dropFrame,
	GAP_WAIT_MS,
	initialLiveState,
	type LiveAnswerState,
	type ReducerEffect,
} from '@/lib/liveReasoning/liveReducer';
import { reportRefusal } from '@/lib/liveReasoning/liveReport';
import streamProof from '@/lib/liveReasoning/streamProof';

export type SessionEnd = StopReason | 'answered' | 'abandoned';

export interface LiveAnswerSessionOptions {
	answerMessageId: string;
	sessionKey: CryptoKey;
	endpoint: StreamEndpoint;
	startStream: (_options: FrameStreamOptions) => FrameStreamHandle;
	onState: (_state: LiveAnswerState) => void;
	onEnd: (_end: SessionEnd) => void;
	now?: () => number;
}

export interface LiveAnswerSession {
	stop(): void;
	/** The tab is shown again: the stream resumes from the cursor if it paused while hidden. */
	wake(): void;
}

/** Whether anything the chat shows, or the comparison with the stored answer reads, changed. */
const shownChanged = (before: LiveAnswerState, after: LiveAnswerState): boolean =>
	before.run !== after.run ||
	before.replica !== after.replica ||
	before.attempt !== after.attempt ||
	before.steps !== after.steps ||
	before.sources !== after.sources ||
	before.answer !== after.answer ||
	before.outcome !== after.outcome;

async function readFrame(sessionKey: CryptoKey, event: StreamEvent) {
	const eventId = parseSseEventId(event.id);
	if (!eventId || !isSealedFrame(event.data)) return null;
	try {
		const frame = parseFrameBytes(await decryptBytes(sessionKey, event.data));
		return frame ? { frame, eventId } : null;
	} catch {
		return null;
	}
}

export function startLiveAnswerSession(options: LiveAnswerSessionOptions): LiveAnswerSession {
	const now = options.now ?? Date.now;
	let state = initialLiveState(options.answerMessageId);
	let handle: FrameStreamHandle | null = null;
	let stopped = false;
	let queue: Promise<FrameVerdict | undefined> = Promise.resolve(undefined);
	let gapTimer: ReturnType<typeof setTimeout> | null = null;

	const stop = () => {
		stopped = true;
		if (gapTimer) clearTimeout(gapTimer);
		gapTimer = null;
		handle?.stop();
	};

	const end = (reason: SessionEnd) => {
		if (stopped) return;
		stop();
		options.onEnd(reason);
	};

	const carryOut = (effect: ReducerEffect) => {
		if (effect !== 'none') handle?.reconnect(effect === 'reconnect-fresh');
	};

	const watchGap = () => {
		if (state.gapSince === null || gapTimer) return;
		gapTimer = setTimeout(() => {
			gapTimer = null;
			if (stopped) return;
			const result = checkGap(state, now());
			state = result.state;
			carryOut(result.effect);
			watchGap();
		}, GAP_WAIT_MS);
	};

	const fold = async (event: StreamEvent): Promise<FrameVerdict | undefined> => {
		const read = await readFrame(options.sessionKey, event);
		if (stopped) return undefined;
		const before = state;
		const result = read
			? applyFrame(state, read.frame, read.eventId, now())
			: { state: dropFrame(state), effect: 'none' as const };
		state = result.state;
		if (shownChanged(before, state)) options.onState(state);
		carryOut(result.effect);
		watchGap();
		if (state.outcome === 'answered' || state.outcome === 'abandoned') end(state.outcome);
		return state.dropped > before.dropped ? 'refused' : 'applied';
	};

	const onStop = (reason: StopReason) => {
		if (reason === 'bad-request' || reason === 'proof-refused') reportRefusal(reason);
		end(reason);
	};

	streamProof(options.sessionKey, options.answerMessageId).then(
		proof => {
			if (stopped) return;
			handle = options.startStream({
				url: streamUrl(options.endpoint, options.answerMessageId),
				proof,
				onEvent: event => {
					// A frame that throws while folded is lost; the frames after it still apply.
					queue = queue.then(() => fold(event)).catch(() => undefined);
					// Settles once this frame is applied or dropped, saying which: the transport
					// measures progress and counts what was refused.
					return queue;
				},
				getCursor: () => cursorOf(state),
				onStop,
			});
		},
		() => end('bad-request'),
	);

	return { stop, wake: () => handle?.wake() };
}
