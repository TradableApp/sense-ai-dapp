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

	it('returns false at steady state (Redux and query identical)', () => {
		const redux = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		const query = [user(4, 'Hi'), answer(5, 'Answer', 4)];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// Composer-stuck-after-cancel reconcile: syncService dropped the cancelled prompt's orphan
	// answer (id 5, parent 4) from the cache and recovered the prompt itself as a
	// status:'cancelled' message (id 4). Redux must drop the orphan too — the placeholder's
	// PARENT prompt is shown cancelled in the query.
	it('returns true when a missing placeholder’s prompt is shown cancelled in the query', () => {
		const redux = [user(4, 'Hold this'), answer(5, null, 4)];
		const query = [user(4, 'Hold this', 'cancelled')]; // placeholder 5 dropped; prompt cancelled
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns true for a refunded prompt’s orphaned placeholder', () => {
		const redux = [user(4, 'Stuck'), answer(5, null, 4)];
		const query = [user(4, 'Stuck', 'refunded')];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	// THE REGENERATE REGRESSION: regenerating produces a new answer version — a content-less
	// placeholder (id 7) that is a SIBLING of the original answer, parented to the SAME user
	// prompt (id 4), which is NOT cancelled. The placeholder is missing from the not-yet-synced
	// query, but it must be KEPT — wiping it means the version pager never appears.
	it('returns false for a fresh regenerate version placeholder (prompt not cancelled)', () => {
		const redux = [user(4, 'Q'), answer(5, 'v1', 4), answer(7, null, 4)];
		const query = [user(4, 'Q'), answer(5, 'v1', 4)];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// THE RESEND-AFTER-CANCEL case: the resend's optimistic prompt + placeholder haven't synced
	// yet. The placeholder's parent (the resend prompt, id 6) is pending — not cancelled — so it
	// must be kept (else the answer never renders).
	it('returns false for a fresh resend whose prompt is pending, not cancelled', () => {
		const redux = [
			user(4, 'Hold this', 'cancelled'),
			user(6, 'Now please answer'),
			answer(7, null, 6),
		];
		const query = [user(4, 'Hold this', 'cancelled')]; // resend not synced yet
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// Once the resend answer is delivered + synced, the query carries the real user message (6)
	// and the answered assistant (7) that optimistic Redux lacks, so hydration must proceed.
	it('returns true once the resend answer is delivered and synced', () => {
		const redux = [user(4, 'Hold this', 'cancelled'), user(6, 'Now please answer'), answer(7, null, 6)];
		const query = [
			user(4, 'Hold this', 'cancelled'),
			user(6, 'Now please answer'),
			answer(7, 'Answer', 6),
		];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	// A no-id optimistic placeholder can't be matched against the query by id, so it is never
	// read as a dropped placeholder.
	it('returns false when a no-id optimistic placeholder is the only Redux-only message', () => {
		const redux = [user(4, 'Hold this', 'cancelled'), answer(undefined, null, 4)];
		const query = [user(4, 'Hold this', 'cancelled')];
		expect(isQueryAhead(redux, query)).toBe(false);
	});
});
