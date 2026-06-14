import { type ActiveMessage } from '@/store/chatSlice';

/**
 * Decides whether the messages query (backed by IndexedDB, hydrated from The Graph by
 * syncService) is more up-to-date than the in-memory Redux state, and Redux should be
 * replaced with it.
 *
 * The query is "ahead" when it carries data Redux lacks — a delivered answer, a status
 * change (pending → cancelled/refunded), or more streamed reasoning. It is ALSO treated
 * as authoritative for one specific REMOVAL: a content-less assistant placeholder whose
 * prompt was cancelled/refunded is dropped from the cache (see
 * syncService.dropCancelledAnswerPlaceholders) and must be dropped from Redux too, or the
 * composer stays stuck "Thinking…".
 *
 * Crucially, that removal-reconcile must NOT fire for a freshly-sent optimistic prompt
 * whose placeholder simply hasn't synced to IndexedDB yet — otherwise sending a new prompt
 * right after a cancel wipes the optimistic resend from Redux (the placeholder AND its user
 * message), `hasPendingAnswer` goes false, the fallback poll never runs, and the answer
 * never renders. The two are told apart by what else is missing: a genuinely-dropped
 * cancelled placeholder is the ONLY thing the query lacks (it has caught up on every real
 * message); a fresh resend also has its USER message missing, which means the query is
 * merely behind — keep Redux.
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

	// The query is authoritative for removals too: a content-less assistant PLACEHOLDER that
	// the query no longer contains was dropped from the cache because its prompt was
	// cancelled/refunded and the answer is never delivered (see
	// syncService.dropCancelledAnswerPlaceholders). isQueryAhead otherwise only detects the
	// query GAINING data, so without this Redux keeps the orphan and the composer stays stuck
	// "Thinking…".
	//
	// The precise signal is the placeholder's PROMPT being cancelled/refunded — NOT merely
	// "a placeholder is missing". A fresh optimistic placeholder (a resend after cancel, or a
	// regenerate/edit version) is also content-less and missing from the not-yet-synced query,
	// but its prompt is pending, not cancelled — wiping it would lose the resend (stuck
	// "Thinking…") or the new answer version (the version pager never appears). syncService
	// recovers a cancelled/refunded prompt into the query as a `status: 'cancelled' | 'refunded'`
	// message keyed by promptMessageId, which is exactly the placeholder's parentId — so only
	// remove a missing placeholder when the query shows its parent prompt cancelled/refunded.
	const queryIds = new Set(queryMessages.filter(m => m.id != null).map(m => String(m.id)));
	const cancelledPromptIds = new Set(
		queryMessages
			.filter(m => (m.status === 'cancelled' || m.status === 'refunded') && m.id != null)
			.map(m => String(m.id)),
	);
	const reduxHasDroppedPlaceholder = reduxMessages.some(
		m =>
			m.role === 'assistant' &&
			(m.content === null || m.content === undefined) &&
			m.id != null &&
			!queryIds.has(String(m.id)) &&
			m.parentId != null &&
			cancelledPromptIds.has(String(m.parentId)),
	);
	if (reduxHasDroppedPlaceholder) {
		return true;
	}

	// Position-independent comparison. The optimistic follow-up placeholder is
	// stamped with wall-clock time while its (already-synced) prompt carries a later
	// on-chain block time, so the placeholder can momentarily sort BEFORE its prompt.
	// Comparing only the last element would then miss a resolved answer that isn't
	// last — leaving a follow-up stuck on "Thinking…". So check every message by id:
	// the query is "ahead" if for any id it carries newer data than Redux holds —
	// content where Redux has none (answer delivered), a status change (pending →
	// cancelled/refunded), or more streamed reasoning.
	// Skip unresolved placeholders (no id) — they carry no content the query could be
	// "ahead" of, and keying them all to '' would collapse several onto one slot and
	// compare the wrong message.
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
