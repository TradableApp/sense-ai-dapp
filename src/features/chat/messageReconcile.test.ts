import { describe, expect, it } from 'vitest';

import { type ActiveMessage } from '@/store/chatSlice';

import isQueryAhead from './messageReconcile';

const user = (id: string | number | undefined, content: string): ActiveMessage => ({
	id,
	role: 'user',
	content,
	status: 'complete',
});

const answer = (id: string | number | undefined, content: string | null): ActiveMessage => ({
	id,
	role: 'assistant',
	content,
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
		const query = [user(4, 'Hi'), answer(5, 'Answer')];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns true when the query delivers content for a pending placeholder', () => {
		const redux = [user(4, 'Hi'), answer(5, null)];
		const query = [user(4, 'Hi'), answer(5, 'Answer')];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	it('returns false at steady state (Redux and query identical)', () => {
		const redux = [user(4, 'Hi'), answer(5, 'Answer')];
		const query = [user(4, 'Hi'), answer(5, 'Answer')];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// The composer-stuck-after-cancel reconcile: syncService.dropCancelledAnswerPlaceholders
	// has removed the cancelled prompt's orphan answer from the cache, so the query is the
	// authority and Redux must drop it too. The placeholder is the ONLY thing the query lacks.
	it('returns true when the only message missing from the query is a dropped cancelled placeholder', () => {
		const redux = [user(4, 'Hold this'), answer(5, null)];
		const query = [user(4, 'Hold this')]; // placeholder 5 dropped by syncService
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	// THE BUG (T-CANCEL-03): after cancelling, the user resends. The fresh optimistic prompt
	// (user message + content-less answer placeholder) hasn't synced to IndexedDB yet, so the
	// query is simply BEHIND — it still reflects only the prior (cancelled) prompt. This must
	// NOT be treated as a dropped-placeholder removal: replacing Redux with the stale query
	// would wipe the resend, hasPendingAnswer would go false, the fallback poll would stop, and
	// the answer would never render. The tell-tale: the resend's USER message is missing too.
	it('returns false for a fresh resend whose prompt + placeholder are not yet synced', () => {
		const redux = [user(4, 'Hold this'), user('tmp', 'Now please answer'), answer(7, null)];
		const query = [user(4, 'Hold this')]; // stale: resend not indexed/synced yet
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// Same resend, but post-receipt the optimistic ids are the real on-chain ids (6, 7).
	it('returns false for a fresh resend even once it carries real on-chain ids', () => {
		const redux = [user(4, 'Hold this'), user(6, 'Now please answer'), answer(7, null)];
		const query = [user(4, 'Hold this')];
		expect(isQueryAhead(redux, query)).toBe(false);
	});

	// Once the resend answer is delivered + synced, the query carries the real user message
	// (6) and the answered assistant (7 with content) that optimistic Redux (temp ids) lacks,
	// so hydration must proceed.
	it('returns true once the resend answer is delivered and synced', () => {
		const redux = [user(4, 'Hold this'), user('tmp', 'Now please answer'), answer(7, null)];
		const query = [user(4, 'Hold this'), user(6, 'Now please answer'), answer(7, 'Answer')];
		expect(isQueryAhead(redux, query)).toBe(true);
	});

	// A purely optimistic placeholder with no id yet must never be read as a dropped
	// placeholder (it can't be matched against the query by id).
	it('returns false when a no-id optimistic placeholder is the only Redux-only message', () => {
		const redux = [user(4, 'Hold this'), answer(undefined, null)];
		const query = [user(4, 'Hold this')];
		expect(isQueryAhead(redux, query)).toBe(false);
	});
});
