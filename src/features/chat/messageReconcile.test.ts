import { describe, expect, it } from 'vitest';

import { type ActiveMessage } from '@/store/chatSlice';

import isQueryAhead from './messageReconcile';

const user = (
	id: string | number | undefined,
	content: string,
	status = 'complete',
): ActiveMessage => ({ id, role: 'user', content, status });

const answer = (
	id: string | number | undefined,
	content: string | null,
	parentId: number | null = null,
): ActiveMessage => ({
	id,
	role: 'assistant',
	content,
	parentId,
	status: content === null ? 'pending' : 'complete',
});

describe('isQueryAhead', () => {
	it('returns false when the query is empty (nothing to hydrate from)', () => {
		expect(isQueryAhead([user(4, 'Hi')], [])).toBe(false);
	});

	it('returns true when Redux is empty but the query has data', () => {
		expect(isQueryAhead([], [user(4, 'Hi')])).toBe(true);
	});

	it('returns true when the query has gained a new message', () => {
		const redux = [user(4, 'Hi')];
		const query = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns true when the query delivers content for a pending placeholder', () => {
		const redux = [user(4, 'Hi'), answer(5, null, 4)];
		const query = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns true when the query reflects a status change (pending → cancelled)', () => {
		const redux = [user(4, 'Hi')];
		const query = [user(4, 'Hi', 'cancelled')];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns false at steady state (Redux and query identical)', () => {
		const redux = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		const query = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// isQueryAhead must NOT infer removals — a content-less placeholder missing from the
	// not-yet-synced query is structurally identical for a cancelled answer and a fresh
	// optimistic one, so wiping it here would break regenerate/resend. Removal of cancelled
	// placeholders is handled explicitly by Chat (cancelledAnswerIdsRef) + syncService.

	// REGENERATE: a new answer version is a content-less placeholder (id 7) parented to the
	// same prompt (id 4) which already has a delivered answer (id 5). The query hasn't synced
	// v7 yet — it must be KEPT, or the version pager never appears.
	it('returns false for a fresh regenerate version placeholder not yet in the query', () => {
		const redux = [user(4, 'Q'), answer(5, 'v1', 4), answer(7, null, 4)];
		const query = [user(4, 'Q'), answer(5, 'v1', 4)];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// RESEND-AFTER-CANCEL: the resend's optimistic prompt (6) + placeholder (7) haven't synced;
	// the query still reflects only the prior (cancelled) prompt. Keep the optimistic resend.
	it('returns false for a fresh resend not yet in the query', () => {
		const redux = [
			user(4, 'Hold this', 'cancelled'),
			user(6, 'Now please answer'),
			answer(7, null, 6),
		];
		const query = [user(4, 'Hold this', 'cancelled')];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// Once the resend answer is delivered + synced, the query carries the real user message (6)
	// and the answered assistant (7) that optimistic Redux lacks, so hydration must proceed.
	// A null-id query message (a hypothetical future provisional IndexedDB entry) must be
	// skipped, not read as "ahead": String(undefined ?? '') would miss reduxById and look new.
	it('does not read a null-id query placeholder as ahead', () => {
		const redux = [user(4, 'Hi'), answer(5, 'A', 4)];
		const query = [user(4, 'Hi'), answer(undefined, null, 4)];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	it('returns true once the resend answer is delivered and synced', () => {
		const redux = [user(4, 'Hold this', 'cancelled'), user(6, 'Now please answer'), answer(7, null, 6)];
		const query = [
			user(4, 'Hold this', 'cancelled'),
			user(6, 'Now please answer'),
			answer(7, 'Answer', 6),
		];
		expect(isQueryAhead(redux, query)).toBe(true);
	});
});
