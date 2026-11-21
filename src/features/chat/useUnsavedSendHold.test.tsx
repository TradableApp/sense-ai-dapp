import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	UNSAVED_BRANCH_REASON,
	UNSAVED_EDIT_REASON,
	UNSAVED_NEW_CONVERSATION_REASON,
	UNSAVED_SEND_COMPOSER_REASON,
	UNSAVED_SEND_REASON,
} from '@/components/ai/sendingReason';

import {
	attachShownPrompt,
	HOLD_LASTS_MS,
	holdUnsavedSend,
	NEW_CONVERSATION_KEY,
	type UnsavedSend,
} from './unsavedSends';
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
	confirmedAt: Date.now(),
};

type Input = Parameters<typeof useUnsavedSendHold>[0];

// Holds are saved and restored into a new client: each test starts with none saved.
beforeEach(() => localStorage.clear());

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

	it('says why the composer is held here, and that edit is off too', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		const { result } = renderHold(queryClient);

		expect(result.current.composerHoldReason).toBe(UNSAVED_SEND_COMPOSER_REASON);
		expect(result.current.editHeldReason).toBe(UNSAVED_EDIT_REASON);
	});

	it('does not say "here" in the new chat for a send that started another conversation', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, {
			...PROMPT_IN_5,
			composerKeys: [NEW_CONVERSATION_KEY, '9'],
			answer: null,
			shownAs: { conversationKey: '9', messageId: '11' },
			listedAs: '9',
		});

		const newChat = renderHold(queryClient, { activeConversationId: null, storedMessages: [] });

		expect(newChat.result.current.composerHoldReason).toBe(UNSAVED_NEW_CONVERSATION_REASON);
		expect(UNSAVED_NEW_CONVERSATION_REASON).not.toMatch(/\bhere\b/);
		expect(newChat.result.current.editHeldReason).toBeNull();
	});

	it('leaves edit and the composer on in another conversation', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		const { result } = renderHold(queryClient, { activeConversationId: '6' });

		expect(result.current.composerHoldReason).toBeNull();
		expect(result.current.editHeldReason).toBeNull();
	});
});

describe('an answer branched from, whose branch was not saved here', () => {
	const BRANCH_FROM_8: UnsavedSend = {
		owner: OWNER,
		kind: 'branch',
		composerKeys: [],
		answer: { conversationKey: '5', answerId: '8' },
		shownAs: null,
		listedAs: '14',
		endsOnPendingFall: false,
		confirmedAt: Date.now(),
	};

	it('says the branch appears in the history once it is listed, not that an answer will come', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, BRANCH_FROM_8);
		const { result } = renderHold(queryClient);

		expect(result.current.heldReasonFor('8')).toBe(UNSAVED_BRANCH_REASON);
		expect(UNSAVED_BRANCH_REASON).toMatch(/history once it is listed/);
		expect(UNSAVED_BRANCH_REASON).not.toMatch(/answer/);
		expect(result.current.composerHoldReason).toBeNull();
	});

	it('is let go once the branch is in the stored list', async () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, BRANCH_FROM_8);
		const { result, rerender } = renderHold(queryClient);
		expect(result.current.heldReasonFor('8')).toBe(UNSAVED_BRANCH_REASON);

		await act(async () => {
			rerender({ conversations: [{ id: '5' }, { id: '14' }] });
		});

		expect(result.current.heldReasonFor('8')).toBeNull();
	});
});

describe('every reason a hold gives', () => {
	const PROMPT_REASONS = [
		UNSAVED_SEND_REASON,
		UNSAVED_EDIT_REASON,
		UNSAVED_SEND_COMPOSER_REASON,
		UNSAVED_NEW_CONVERSATION_REASON,
	];

	// A reload no longer clears a hold, so telling the user to reload would mislead.
	it.each([...PROMPT_REASONS, UNSAVED_BRANCH_REASON])('does not say to reload: %s', reason => {
		expect(reason).not.toMatch(/reload/i);
	});

	it.each(PROMPT_REASONS)('says when it ends, and that a refund can then be claimed: %s', reason => {
		expect(reason).toMatch(/back in your history/);
		expect(reason).toMatch(/at the latest, an hour after it was sent, when a refund can be claimed/);
	});

	// A branch's fee is paid directly: there is no refund to claim for it.
	it('a branch says when it ends, and promises no refund', () => {
		expect(UNSAVED_BRANCH_REASON).toMatch(/in your history/);
		expect(UNSAVED_BRANCH_REASON).toMatch(/at the latest, an hour after it was sent/);
		expect(UNSAVED_BRANCH_REASON).not.toMatch(/refund/);
	});

	// The composer's conversation may be showing the prompt from its receipt.
	it.each([UNSAVED_SEND_COMPOSER_REASON, UNSAVED_EDIT_REASON, UNSAVED_SEND_REASON])(
		'does not say the prompt is not shown: %s',
		reason => {
			expect(reason).not.toMatch(/not shown/);
		},
	);
});

describe('a hold an hour after its send was confirmed', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('is let go, so the composer sends again', () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, { ...PROMPT_IN_5, confirmedAt: Date.now() });
		const { result } = renderHold(queryClient);
		expect(result.current.isComposerHeld).toBe(true);

		act(() => {
			vi.advanceTimersByTime(HOLD_LASTS_MS);
		});

		expect(result.current.isComposerHeld).toBe(false);
	});
});

describe('the prompt shown from its receipt, kept with the hold', () => {
	const SHOWN = [
		{ id: '11', role: 'user', content: 'q', conversationId: '5' },
		{ id: '12', role: 'assistant', content: null, conversationId: '5', parentId: '11' },
	];

	it('is given back for its conversation, and for no other', () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		attachShownPrompt(queryClient, OWNER, '11', SHOWN);

		expect(renderHold(queryClient).result.current.shownPrompt).toEqual(SHOWN);
		expect(renderHold(queryClient, { activeConversationId: '6' }).result.current.shownPrompt).toBeNull();
	});

	it('is not given back once the hold has ended', async () => {
		const queryClient = new QueryClient();
		holdUnsavedSend(queryClient, PROMPT_IN_5);
		attachShownPrompt(queryClient, OWNER, '11', SHOWN);
		const { result, rerender } = renderHold(queryClient);

		await act(async () => {
			rerender({ storedMessages: [{ id: '11' }, { id: '12' }] });
		});

		expect(result.current.shownPrompt).toBeNull();
	});
});
