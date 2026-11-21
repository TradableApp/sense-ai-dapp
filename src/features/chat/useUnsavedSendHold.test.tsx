import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UNSAVED_SEND_REASON } from '@/components/ai/sendingReason';

import { holdUnsavedSend, NEW_CONVERSATION_KEY, type UnsavedSend } from './unsavedSends';
import useUnsavedSendHold from './useUnsavedSendHold';

const OWNER = '0x00000000000000000000000000000000000000aa';

const PROMPT_IN_5: UnsavedSend = {
	owner: OWNER,
	kind: 'prompt',
	composerKeys: ['5'],
	answer: { conversationKey: '5', answerId: '4' },
	shownAs: { conversationKey: '5', messageId: '11' },
	listedAs: null,
	endsOnPendingFall: true,
};

type Input = Parameters<typeof useUnsavedSendHold>[0];

function renderHold(queryClient: QueryClient, input: Partial<Input> = {}) {
	return renderHook((props: Partial<Input>) =>
		useUnsavedSendHold({
			queryClient,
			activeConversationId: '5',
			ownerAddress: OWNER,
			storedMessages: [{ id: '3' }, { id: '4' }],
			conversations: [{ id: '5' }],
			...input,
			...props,
		}),
	);
}

describe('a conversation with a paid send that was not saved here', () => {
	it('holds its composer, and no other conversation’s', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);

		expect(renderHold(queryClient).result.current.isComposerHeld).toBe(true);
		expect(
			renderHold(queryClient, { activeConversationId: '6' }).result.current.isComposerHeld,
		).toBe(false);
	});

	it('switches off regenerate and branch on the answer it threads off, with a reason', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		const { heldReasonFor } = renderHold(queryClient).result.current;

		expect(heldReasonFor('4')).toBe(UNSAVED_SEND_REASON);
		expect(heldReasonFor(4)).toBe(UNSAVED_SEND_REASON);
		expect(heldReasonFor('2')).toBeNull();
	});

	it('is let go once its stored messages show the prompt', async () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		const { result, rerender } = renderHold(queryClient);
		expect(result.current.isComposerHeld).toBe(true);

		await act(async () => {
			rerender({ storedMessages: [{ id: '3' }, { id: '4' }, { id: '11' }, { id: '12' }] });
		});

		expect(result.current.isComposerHeld).toBe(false);
		expect(result.current.heldReasonFor('4')).toBeNull();
	});

	it('holds the new-chat composer for a send that started a conversation', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, {
			...PROMPT_IN_5,
			composerKeys: [NEW_CONVERSATION_KEY, '9'],
			answer: null,
			shownAs: { conversationKey: '9', messageId: '11' },
			listedAs: '9',
		});

		const newChat = renderHold(queryClient, { activeConversationId: null, storedMessages: [] });
		expect(newChat.result.current.isComposerHeld).toBe(true);
		const opened = renderHold(queryClient, { activeConversationId: '9', storedMessages: [] });
		expect(opened.result.current.isComposerHeld).toBe(true);
	});

	it('holds nothing for another wallet', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);

		const other = renderHold(queryClient, { ownerAddress: `0x${'b'.repeat(40)}` });
		expect(other.result.current.isComposerHeld).toBe(false);
	});
});
