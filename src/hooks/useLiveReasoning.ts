import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import reasoningStreamEndpoint from '@/config/reasoningStream';
import { startFrameStream } from '@/lib/liveReasoning/frameTransport';
import {
	type LiveAnswerSession,
	type SessionEnd,
	startLiveAnswerSession,
} from '@/lib/liveReasoning/liveAnswerSession';
import type { LiveAnswerState } from '@/lib/liveReasoning/liveReducer';
import {
	clearLiveView,
	clearLiveViews,
	readLiveViews,
	setLiveView,
	subscribeLiveViews,
} from '@/lib/liveReasoning/liveStore';
import {
	type MessageLike,
	pendingAnswerIds,
	storedAnswerFor,
} from '@/lib/liveReasoning/pendingAnswers';
import { reconcileWithStored, type StoredAnswer } from '@/lib/liveReasoning/reconcile';

/** Ends after which nothing is kept on screen: the run was dropped, or the stream refused us. */
const CLEARING_ENDS: ReadonlySet<SessionEnd> = new Set([
	'abandoned',
	'bad-request',
	'proof-refused',
]);

/** `performance` names read by the e2e suite (no telemetry is sent). */
const liveAnswerMark = (id: string) => `live-answer:${id}`;
const storedAnswerMark = (id: string) => `stored-answer:${id}`;
const leadMeasure = (id: string) => `live-answer-lead:${id}`;

function tryPerformance(record: () => void) {
	try {
		record();
	} catch {
		// Timing is for the e2e suite only; a browser without it changes nothing.
	}
}

export interface LiveReasoning {
	/** What is shown live for an awaited answer, or undefined when nothing is. */
	viewFor(_answerMessageId: string | number | null | undefined): LiveAnswerState | undefined;
	/** Whether a provisional answer was shown for this id, so the stored one is not typed again. */
	hadProvisionalAnswer(_answerMessageId: string | number | null | undefined): boolean;
}

interface LiveReasoningInput {
	messages: readonly (MessageLike & StoredAnswer)[];
	sessionKey: CryptoKey | null;
	ownerAddress: string | null;
}

/**
 * The live reasoning overlay for the open conversation: one stream per awaited answer, while
 * it is awaited. Everything it shows is in memory (`liveStore.ts`) and is an overlay at render:
 * the composer, cancel and every paid-send rule keep reading the stored messages. With the
 * setting unset, or no session key, it starts nothing and shows nothing.
 *
 * A stream stops when the stored answer lands (what was shown is then compared with it and a
 * difference reported once), when the answer stops being awaited (cancel, refund, another
 * conversation opened), when the component unmounts, and when the wallet or session changes;
 * in each case what was shown is cleared.
 */
export default function useLiveReasoning({
	messages,
	sessionKey,
	ownerAddress,
}: LiveReasoningInput): LiveReasoning {
	const endpoint = useMemo(() => reasoningStreamEndpoint(), []);
	const views = useSyncExternalStore(subscribeLiveViews, readLiveViews);
	const sessionsRef = useRef(new Map<string, LiveAnswerSession>());
	const endedRef = useRef(new Set<string>());
	const provisionalRef = useRef(new Set<string>());
	const pendingKey = pendingAnswerIds(messages).join(',');

	// A new wallet or session (or unmount) stops every stream and clears what was shown.
	useEffect(() => {
		const sessions = sessionsRef.current;
		const ended = endedRef.current;
		const provisional = provisionalRef.current;
		return () => {
			sessions.forEach(session => session.stop());
			clearLiveViews([...sessions.keys(), ...ended]);
			sessions.clear();
			ended.clear();
			provisional.clear();
		};
	}, [sessionKey, ownerAddress, endpoint]);

	useEffect(() => {
		if (!endpoint || !sessionKey) return;
		const sessions = sessionsRef.current;
		const ended = endedRef.current;
		const pending = new Set(pendingKey ? pendingKey.split(',') : []);

		const land = (id: string) => {
			sessions.get(id)?.stop();
			sessions.delete(id);
			ended.delete(id);
			const live = readLiveViews().get(id);
			const stored = storedAnswerFor(messages, id);
			if (live && stored) {
				reconcileWithStored(id, live, stored);
				if (provisionalRef.current.has(id)) {
					tryPerformance(() => {
						performance.mark(storedAnswerMark(id));
						performance.measure(leadMeasure(id), liveAnswerMark(id), storedAnswerMark(id));
					});
				}
			}
			clearLiveView(id);
		};

		const start = (id: string) =>
			startLiveAnswerSession({
				answerMessageId: id,
				sessionKey,
				endpoint,
				startStream: startFrameStream,
				onState: state => {
					setLiveView(id, state);
					if (state.answer && !provisionalRef.current.has(id)) {
						provisionalRef.current.add(id);
						tryPerformance(() => performance.mark(liveAnswerMark(id)));
					}
				},
				onEnd: reason => {
					sessions.delete(id);
					ended.add(id);
					if (CLEARING_ENDS.has(reason)) clearLiveView(id);
				},
			});

		[...sessions.keys(), ...ended].filter(id => !pending.has(id)).forEach(land);
		pending.forEach(id => {
			if (!sessions.has(id) && !ended.has(id)) sessions.set(id, start(id));
		});
	}, [pendingKey, messages, sessionKey, endpoint]);

	const viewFor = useCallback(
		(id: string | number | null | undefined) => (id == null ? undefined : views.get(String(id))),
		[views],
	);
	const hadProvisionalAnswer = useCallback(
		(id: string | number | null | undefined) =>
			id != null && provisionalRef.current.has(String(id)),
		[],
	);
	return useMemo(() => ({ viewFor, hadProvisionalAnswer }), [viewFor, hadProvisionalAnswer]);
}
