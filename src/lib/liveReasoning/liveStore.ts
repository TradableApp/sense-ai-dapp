/**
 * What is shown live, per answer id, in memory only, and the store `useLiveReasoning` reads it
 * from (`useSyncExternalStore`). Nothing here is written to IndexedDB, Redux, the query cache or
 * browser storage (the `live-reasoning-ephemeral` guard): a reload, an unmount or a session
 * change leaves nothing behind, and the stored answer is always what the chat falls back to.
 */
import type { LiveAnswerState } from '@/lib/liveReasoning/liveReducer';

export type LiveViews = ReadonlyMap<string, LiveAnswerState>;

let views: LiveViews = new Map();
const subscribers = new Set<() => void>();

const publish = (next: LiveViews) => {
	views = next;
	subscribers.forEach(notify => notify());
};

export function setLiveView(answerMessageId: string, state: LiveAnswerState): void {
	publish(new Map(views).set(answerMessageId, state));
}

export function clearLiveView(answerMessageId: string): void {
	if (!views.has(answerMessageId)) return;
	const next = new Map(views);
	next.delete(answerMessageId);
	publish(next);
}

export function clearLiveViews(answerMessageIds: Iterable<string>): void {
	const ids = [...answerMessageIds].filter(id => views.has(id));
	if (ids.length === 0) return;
	const next = new Map(views);
	ids.forEach(id => next.delete(id));
	publish(next);
}

export const readLiveViews = (): LiveViews => views;

export function subscribeLiveViews(notify: () => void): () => void {
	subscribers.add(notify);
	return () => {
		subscribers.delete(notify);
	};
}
