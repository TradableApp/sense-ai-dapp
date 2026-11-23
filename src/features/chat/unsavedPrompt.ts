import type { QueryClient } from '@tanstack/react-query';

import promptPair from '@/lib/promptPair';
import {
	type ActiveMessage,
	appendLiveMessages,
	setActiveConversationId,
	setActiveConversationMessages,
} from '@/store/chatSlice';
import type { AppDispatch, RootState } from '@/store/store';

import { attachShownPrompt } from './unsavedSends';

/** The ids a confirmed prompt's receipt gave. */
export interface PromptIds {
	conversationId: string;
	promptMessageId: string;
	answerMessageId: string;
}

interface UnsavedPromptInput {
	activeConversationId: string | number | null | undefined;
	parentId: string | number | null | undefined;
	content: string;
	ids: PromptIds;
	/** When the send was confirmed: the prompt's time, which the refund countdown runs from. */
	at: number;
	/** Where the send's hold is kept, so the prompt is kept with it (in memory only). */
	queryClient: QueryClient;
	ownerAddress: string | null | undefined;
}

/**
 * Shows a confirmed prompt whose save failed, from its receipt's ids, awaiting its answer: in
 * the conversation it was sent in, or in the new one it started. Only in memory: the stored
 * messages still lack it, which is what keeps the conversation held (`useUnsavedSendHold`).
 * Shown, it can be cancelled in the window the escrow allows, instead of waiting for a refund.
 * It is kept with the hold, never saved, so the chat shows it again when the conversation is
 * opened again, until the hold ends.
 */
export default function showUnsavedPrompt(
	dispatch: AppDispatch,
	{ activeConversationId, parentId, content, ids, at, queryClient, ownerAddress }: UnsavedPromptInput,
): void {
	const conversationId = activeConversationId ? String(activeConversationId) : ids.conversationId;
	const { finalUserMessage, finalAiMessage } = promptPair({
		conversationId,
		parentId: activeConversationId && parentId != null ? String(parentId) : null,
		content,
		promptMessageId: ids.promptMessageId,
		answerMessageId: ids.answerMessageId,
		now: at,
	});
	const messages = [finalUserMessage, finalAiMessage] as unknown as ActiveMessage[];
	if (ownerAddress) attachShownPrompt(queryClient, ownerAddress, ids.promptMessageId, messages);
	if (activeConversationId) {
		dispatch(appendLiveMessages(messages));
		return;
	}
	dispatch(setActiveConversationId(conversationId));
	dispatch(setActiveConversationMessages(messages));
}

/**
 * A confirmed send's save with no wallet address to save under. Thrown, not returned: a
 * return would resolve the save as if it worked, with no warning and the paid text left in
 * the composer to be sent again.
 */
export function noWalletAddressError(): Error {
	return new Error('There is no wallet address to save the confirmed send under.');
}

/**
 * Whether `conversationId` (null for the new chat) is the conversation open in the store now.
 * A save that ends after another was opened must not act on the one open then.
 */
export function isActiveConversation(
	state: Pick<RootState, 'chat'>,
	conversationId: string | number | null | undefined,
): boolean {
	const open = state.chat.activeConversationId;
	return (open == null ? null : String(open)) === (conversationId ? String(conversationId) : null);
}
