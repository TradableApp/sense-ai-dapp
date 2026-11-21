import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFUND_TIMEOUT_MS } from '@/lib/constants';

import {
	endExpiredSends,
	endsHoldAt,
	endShownSends,
	HOLD_LASTS_MS,
	holdUnsavedSend,
	NEW_CONVERSATION_KEY,
	notePendingCount,
	attachShownPrompt,
	type UnsavedSend,
	unsavedSendFor,
	useUnsavedSends,
} from './unsavedSends';
import { parseSavedSends, savedSendsKey } from './unsavedSendsStorage';

const OWNER = '0x00000000000000000000000000000000000000aa';
const OTHER = `0x${'b'.repeat(40)}`;
/** When the sends in these tests were confirmed; the holds begin a second later. */
const CONFIRMED_AT = 1_000_000;
const BEGAN_AT = CONFIRMED_AT + 1_000;
/** A reading asked for after the hold began. */
const AFTER = BEGAN_AT + 1;

const promptIn = (conversationId: string | number) =>
	unsavedSendFor(
		'prompt',
		{ conversationId, parentId: 4, parentCID: 'cid-4' },
		{ conversationId: '9', promptMessageId: '11', answerMessageId: '12' },
		OWNER,
		CONFIRMED_AT,
	) as UnsavedSend;

// Saved holds are restored into a new client, as into a new page: each test starts with none.
beforeEach(() => localStorage.clear());

function held(queryClient: QueryClient, owner = OWNER) {
	return renderHook(() => useUnsavedSends(queryClient, owner)).result;
}

describe('what a confirmed send that was not saved holds', () => {
	it('a prompt in a conversation: its composer and the answer it threads off, until the prompt shows', () => {
		expect(promptIn('5')).toEqual({
			owner: OWNER,
			kind: 'prompt',
			composerKeys: ['5'],
			answer: { conversationKey: '5', answerId: '4' },
			shownAs: { conversationKey: '5', messageId: '11' },
			listedAs: null,
			endsOnPendingFall: true,
			confirmedAt: CONFIRMED_AT,
		});
	});

	it('a prompt starting a conversation: the new-chat composer and the new conversation', () => {
		expect(promptIn(0)).toMatchObject({
			composerKeys: [NEW_CONVERSATION_KEY, '9'],
			answer: null,
			shownAs: { conversationKey: '9', messageId: '11' },
			listedAs: '9',
			endsOnPendingFall: true,
		});
	});

	it('a regenerate: its composer and the answer regenerated, until the new answer shows', () => {
		const send = unsavedSendFor(
			'regenerate',
			{ conversationId: '5', promptMessageId: '6', originalAnswerMessageId: '7' },
			{ newAnswerMessageId: '13' },
			OWNER,
			CONFIRMED_AT,
		);

		expect(send).toMatchObject({
			composerKeys: ['5'],
			answer: { conversationKey: '5', answerId: '7' },
			shownAs: { conversationKey: '5', messageId: '13' },
			endsOnPendingFall: true,
		});
	});

	// A branch adds nothing to the conversation it came from, so its composer threads off the
	// right answer; and its fee is paid directly, so the pending count does not move for it.
	it('a branch: the answer branched from only, until the branch is listed', () => {
		const send = unsavedSendFor(
			'branch',
			{ originalConversationId: '5', branchPointMessageId: '8' },
			{ newConversationId: '14' },
			OWNER,
			CONFIRMED_AT,
		);

		expect(send).toMatchObject({
			composerKeys: [],
			answer: { conversationKey: '5', answerId: '8' },
			shownAs: null,
			listedAs: '14',
			endsOnPendingFall: false,
		});
	});

	it('the same hold when an id arrives as a bigint', () => {
		const asStrings = unsavedSendFor(
			'prompt',
			{ conversationId: '5' },
			{ promptMessageId: '7', answerMessageId: '8' },
			OWNER,
			CONFIRMED_AT,
		);
		const asBigints = unsavedSendFor(
			'prompt',
			{ conversationId: 5n },
			{ promptMessageId: 7n, answerMessageId: 8n },
			OWNER,
			CONFIRMED_AT,
		);

		expect(asStrings).not.toBeNull();
		expect(asBigints).toEqual(asStrings);
	});

	it('nothing, when the receipt gave no ids', () => {
		expect(unsavedSendFor('prompt', { conversationId: '5' }, undefined, OWNER, CONFIRMED_AT)).toBeNull();
		expect(unsavedSendFor('branch', { originalConversationId: '5' }, {}, OWNER, CONFIRMED_AT)).toBeNull();
	});
});

describe('the held sends, per query client', () => {
	it('are seen by every chat on the same client, and by no other client or wallet', () => {
		const queryClient = new QueryClient();
		const first = held(queryClient);
		const reopened = held(queryClient);
		const otherClient = held(new QueryClient());
		const otherWallet = held(queryClient, OTHER);

		act(() => holdUnsavedSend(queryClient, promptIn('5')));

		expect(first.current).toHaveLength(1);
		expect(reopened.current).toHaveLength(1);
		expect(otherClient.current).toHaveLength(0);
		expect(otherWallet.current).toHaveLength(0);
	});

	it('end once the stored messages of their conversation show the message', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		act(() => holdUnsavedSend(queryClient, promptIn('5')));

		act(() =>
			endShownSends(queryClient, OWNER, {
				conversationKey: '6',
				storedMessageIds: ['11'],
				listedConversationIds: [],
			}),
		);
		expect(sends.current).toHaveLength(1);

		act(() =>
			endShownSends(queryClient, OWNER, {
				conversationKey: '5',
				storedMessageIds: ['3', '4', '11'],
				listedConversationIds: [],
			}),
		);
		expect(sends.current).toHaveLength(0);
	});

	it('a branch ends once it is listed', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		const branch = unsavedSendFor(
			'branch',
			{ originalConversationId: '5', branchPointMessageId: '8' },
			{ newConversationId: '14' },
			OWNER,
			CONFIRMED_AT,
		) as UnsavedSend;
		act(() => holdUnsavedSend(queryClient, branch));

		act(() =>
			endShownSends(queryClient, OWNER, {
				conversationKey: null,
				storedMessageIds: [],
				listedConversationIds: ['5', '14'],
			}),
		);

		expect(sends.current).toHaveLength(0);
	});

	it("end on a reading of the wallet's pending count below the highest seen since they began", () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() => notePendingCount(queryClient, OTHER, 0n, AFTER));
		act(() => notePendingCount(queryClient, OWNER, 2n, AFTER));
		act(() => notePendingCount(queryClient, OWNER, 2n, AFTER + 1));
		expect(sends.current).toHaveLength(1);

		act(() => notePendingCount(queryClient, OWNER, 1n, AFTER + 2));
		expect(sends.current).toHaveLength(0);
	});

	// The answer may land before the hold exists (a save given up on after 30 s): the count
	// is then already back where it was, and no fall will ever be seen.
	it('end on a reading of zero asked for after they began', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() => notePendingCount(queryClient, OWNER, 0n, AFTER));

		expect(sends.current).toHaveLength(0);
	});

	// A request sent before the send was counted, or answered by a lagging node, can carry a
	// zero that says nothing about this send.
	it('are not ended by a reading asked for before they began, zero included', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() => notePendingCount(queryClient, OWNER, 0n, BEGAN_AT - 1));
		act(() => notePendingCount(queryClient, OWNER, 3n, BEGAN_AT - 1));
		expect(sends.current).toHaveLength(1);

		// Nor does an older reading set the count a later one is compared with.
		act(() => notePendingCount(queryClient, OWNER, 2n, AFTER));
		expect(sends.current).toHaveLength(1);
		act(() => notePendingCount(queryClient, OWNER, 1n, AFTER + 1));
		expect(sends.current).toHaveLength(0);
	});

	// A branch's fee is paid directly: the count does not move for it, so it never ends one.
	it('a branch is not ended by the count', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		const branch = unsavedSendFor(
			'branch',
			{ originalConversationId: '5', branchPointMessageId: '8' },
			{ newConversationId: '14' },
			OWNER,
			CONFIRMED_AT,
		) as UnsavedSend;
		act(() => holdUnsavedSend(queryClient, branch, BEGAN_AT));

		act(() => notePendingCount(queryClient, OWNER, 0n, AFTER));

		expect(sends.current.map(send => send.kind)).toEqual(['branch']);
	});

	// A refund can be claimed an hour after the send: from then the stuck-request list shows
	// it, and the hold has nothing left to protect.
	it('end an hour after the send was confirmed, and not before', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() => endExpiredSends(queryClient, OWNER, CONFIRMED_AT + HOLD_LASTS_MS - 1));
		expect(sends.current).toHaveLength(1);
		act(() => endExpiredSends(queryClient, OWNER, CONFIRMED_AT + HOLD_LASTS_MS));
		expect(sends.current).toHaveLength(0);
	});

	it('give the same list to a render that changed nothing', () => {
		const queryClient = new QueryClient();
		act(() => holdUnsavedSend(queryClient, promptIn('5')));
		const { result, rerender } = renderHook(() => useUnsavedSends(queryClient, OWNER));
		const first = result.current;

		rerender();

		expect(result.current).toBe(first);
	});
});

describe('whether a reading of the pending count ends a hold', () => {
	it.each([
		[null, 0n, true],
		[null, 3n, false],
		[2n, 0n, true],
		[2n, 1n, true],
		[2n, 2n, false],
		[2n, 3n, false],
	] as const)('highest seen %s, read %s: %s', (peak, count, ends) => {
		expect(endsHoldAt(peak, count)).toBe(ends);
	});
});

describe('a held send across a reload', () => {
	afterEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	const key = () => savedSendsKey(OWNER) as string;
	const later = (queryClient: QueryClient) => held(queryClient);

	it('lasts as long as a refund takes to become claimable', () => {
		expect(HOLD_LASTS_MS).toBe(REFUND_TIMEOUT_MS);
	});

	it('is saved when it begins, with ids, kind, keys and times only', () => {
		const queryClient = new QueryClient();
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));
		act(() =>
			attachShownPrompt(queryClient, OWNER, '11', [
				{ id: '11', role: 'user', content: 'the paid prompt text' },
			]),
		);

		const saved = localStorage.getItem(key()) ?? '';
		expect(JSON.parse(saved)).toEqual([
			{
				owner: OWNER,
				kind: 'prompt',
				composerKeys: ['5'],
				answer: { conversationKey: '5', answerId: '4' },
				shownAs: { conversationKey: '5', messageId: '11' },
				listedAs: null,
				endsOnPendingFall: true,
				confirmedAt: CONFIRMED_AT,
			},
		]);
		expect(saved).not.toContain('the paid prompt text');
	});

	it('is restored into a new page, for the same wallet only', () => {
		act(() => holdUnsavedSend(new QueryClient(), promptIn('5'), BEGAN_AT));
		vi.spyOn(Date, 'now').mockReturnValue(CONFIRMED_AT + 60_000);

		expect(later(new QueryClient()).current).toEqual([
			expect.objectContaining({ kind: 'prompt', shownAs: { conversationKey: '5', messageId: '11' } }),
		]);
		expect(held(new QueryClient(), OTHER).current).toEqual([]);
	});

	it('is removed from storage when it ends', () => {
		const queryClient = new QueryClient();
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() =>
			endShownSends(queryClient, OWNER, {
				conversationKey: '5',
				storedMessageIds: ['11'],
				listedConversationIds: [],
			}),
		);

		expect(localStorage.getItem(key())).toBeNull();
	});

	it('is not restored an hour after it was confirmed', () => {
		act(() => holdUnsavedSend(new QueryClient(), promptIn('5'), BEGAN_AT));
		vi.spyOn(Date, 'now').mockReturnValue(CONFIRMED_AT + HOLD_LASTS_MS);

		expect(later(new QueryClient()).current).toEqual([]);
	});

	it.each([
		['not JSON', '{'],
		['not a list', JSON.stringify({ owner: OWNER })],
		['another wallet', JSON.stringify([{ ...promptIn('5'), owner: OTHER }])],
		['an unknown kind', JSON.stringify([{ ...promptIn('5'), kind: 'transfer' }])],
		['an id that is not a number', JSON.stringify([{ ...promptIn('5'), composerKeys: ['<b>'] }])],
		['a time in the future', JSON.stringify([{ ...promptIn('5'), confirmedAt: CONFIRMED_AT * 9 }])],
		['no time', JSON.stringify([{ ...promptIn('5'), confirmedAt: undefined }])],
	])('ignores a saved value with %s', (_name, raw) => {
		expect(parseSavedSends(raw, OWNER, CONFIRMED_AT + 1)).toEqual([]);
	});

	it('keeps nothing but the fields it knows from a saved value', () => {
		const raw = JSON.stringify([{ ...promptIn('5'), content: 'smuggled', extra: { a: 1 } }]);

		const [restored] = parseSavedSends(raw, OWNER, CONFIRMED_AT + 1);

		expect(restored).not.toHaveProperty('content');
		expect(restored).not.toHaveProperty('extra');
		expect(restored).toMatchObject({ kind: 'prompt', confirmedAt: CONFIRMED_AT });
	});

	it('is held in memory when storage throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});
		const queryClient = new QueryClient();
		const sends = held(queryClient);

		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		expect(sends.current).toHaveLength(1);
	});
});

describe('the prompt shown from its receipt', () => {
	it('is kept with its hold in memory, and goes when the hold ends', () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		const shown = [
			{ id: '11', role: 'user', content: 'q' },
			{ id: '12', role: 'assistant', content: null },
		];
		act(() => holdUnsavedSend(queryClient, promptIn('5'), BEGAN_AT));

		act(() => attachShownPrompt(queryClient, OWNER, '11', shown));
		expect(sends.current[0].shownPrompt).toEqual(shown);

		act(() => notePendingCount(queryClient, OWNER, 0n, AFTER));
		expect(sends.current).toEqual([]);
	});
});
