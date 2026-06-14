import { type ActiveMessage } from '@/store/chatSlice';

/**
 * Decides whether the messages query (backed by IndexedDB, hydrated from The Graph by
 * syncService) carries newer data than the in-memory Redux state, so Redux should be
 * replaced with it.
 *
 * It detects only the query GAINING data — a delivered answer, a status change, or more
 * streamed reasoning. It deliberately does NOT try to reconcile REMOVALS: a content-less
 * assistant placeholder that's missing from the query is structurally identical whether its
 * prompt was cancelled (answer dropped → should be removed) or is simply pending/optimistic
 * (a fresh resend, a regenerate/edit version → must be kept). The message arrays carry no
 * reliable signal to tell those apart (a cancelled prompt is not consistently re-indexed with
 * a `cancelled` status by the time hydration runs), so removal is driven explicitly elsewhere:
 * the cancelling code path knows the cancelled answerMessageId and Chat filters it out on
 * hydrate (see `cancelledAnswerIdsRef`), backed by syncService.dropCancelledAnswerPlaceholders
 * dropping it from the cache. Inferring removal here wipes legitimate fresh placeholders.
 */
export default function isQueryAhead(
	reduxMessages: ActiveMessage[],
	queryMessages: ActiveMessage[],
): boolean {
	if (!queryMessages || queryMessages.length === 0) {
		return false;
	}
	if (reduxMessages.length === 0) {
		return true;
	}

	// The query has a message Redux doesn't yet (e.g. a new answer).
	if (queryMessages.length > reduxMessages.length) {
		return true;
	}

	// Position-independent comparison. The optimistic follow-up placeholder is stamped with
	// wall-clock time while its (already-synced) prompt carries a later on-chain block time, so
	// the placeholder can momentarily sort BEFORE its prompt. Comparing only the last element
	// would then miss a resolved answer that isn't last — leaving a follow-up stuck on
	// "Thinking…". So check every message by id: the query is "ahead" if for any id it carries
	// newer data than Redux holds — content where Redux has none (answer delivered), a status
	// change (pending → cancelled/refunded), or more streamed reasoning.
	// Skip unresolved placeholders (no id) — they carry no content the query could be "ahead"
	// of, and keying them all to '' would collapse several onto one slot and compare the wrong
	// message.
	const reduxById = new Map(reduxMessages.filter(m => m.id != null).map(m => [String(m.id), m]));
	return queryMessages.some(queryMsg => {
		const reduxMsg = reduxById.get(String(queryMsg.id ?? ''));
		if (!reduxMsg) {
			return true; // query carries a message Redux is missing
		}
		if (queryMsg.status !== reduxMsg.status) {
			return true;
		}
		if (((queryMsg.reasoning?.length as number) || 0) > ((reduxMsg.reasoning?.length as number) || 0)) {
			return true;
		}
		if (queryMsg.content && !reduxMsg.content) {
			return true;
		}
		return false;
	});
}
