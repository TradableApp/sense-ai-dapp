import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
	endSendsOnPendingFall,
	endShownSends,
	holdUnsavedSend,
	NEW_CONVERSATION_KEY,
	type UnsavedSend,
	unsavedSendFor,
	useUnsavedSends,
} from './unsavedSends';

const OWNER = '0x00000000000000000000000000000000000000aa';
const OTHER = `0x${'b'.repeat(40)}`;

const promptIn = (conversationId: string | number) =>
	unsavedSendFor(
		'prompt',
		{ conversationId, parentId: 4, parentCID: 'cid-4' },
		{ conversationId: '9', promptMessageId: '11', answerMessageId: '12' },
		OWNER,
	) as UnsavedSend;

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
		);

		expect(send).toMatchObject({
			composerKeys: [],
			answer: { conversationKey: '5', answerId: '8' },
			shownAs: null,
			listedAs: '14',
			endsOnPendingFall: false,
		});
	});

	it('nothing, when the receipt gave no ids', () => {
		expect(unsavedSendFor('prompt', { conversationId: '5' }, undefined, OWNER)).toBeNull();
		expect(unsavedSendFor('branch', { originalConversationId: '5' }, {}, OWNER)).toBeNull();
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

	it("end when the wallet's pending count falls, a branch's excepted", () => {
		const queryClient = new QueryClient();
		const sends = held(queryClient);
		const branch = unsavedSendFor(
			'branch',
			{ originalConversationId: '5', branchPointMessageId: '8' },
			{ newConversationId: '14' },
			OWNER,
		) as UnsavedSend;
		act(() => {
			holdUnsavedSend(queryClient, promptIn('5'));
			holdUnsavedSend(queryClient, branch);
		});

		act(() => endSendsOnPendingFall(queryClient, OTHER));
		expect(sends.current).toHaveLength(2);

		act(() => endSendsOnPendingFall(queryClient, OWNER));
		expect(sends.current.map(send => send.kind)).toEqual(['branch']);
	});
});
