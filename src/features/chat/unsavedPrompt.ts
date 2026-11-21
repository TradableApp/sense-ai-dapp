import promptPair from '@/lib/promptPair';
import {
	type ActiveMessage,
	appendLiveMessages,
	setActiveConversationId,
	setActiveConversationMessages,
} from '@/store/chatSlice';
import type { AppDispatch } from '@/store/store';

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
}

/**
 * Shows a confirmed prompt whose save failed, from its receipt's ids, awaiting its answer: in
 * the conversation it was sent in, or in the new one it started. Only in memory: the stored
 * messages still lack it, which is what keeps the conversation held (`useUnsavedSendHold`).
 * Shown, it can be cancelled in the window the escrow allows, instead of waiting for a refund.
 */
export default function showUnsavedPrompt(
	dispatch: AppDispatch,
	{ activeConversationId, parentId, content, ids }: UnsavedPromptInput,
): void {
	const conversationId = activeConversationId ? String(activeConversationId) : ids.conversationId;
	const { finalUserMessage, finalAiMessage } = promptPair({
		conversationId,
		parentId: activeConversationId && parentId != null ? String(parentId) : null,
		content,
		promptMessageId: ids.promptMessageId,
		answerMessageId: ids.answerMessageId,
	});
	const messages = [finalUserMessage, finalAiMessage] as unknown as ActiveMessage[];
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
