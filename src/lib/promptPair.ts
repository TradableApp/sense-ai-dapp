import type { Message } from './types';

export interface PromptPairInput {
	conversationId: string;
	parentId: string | null;
	content: string;
	promptMessageId: string;
	answerMessageId: string;
	now?: number;
}

/**
 * A sent prompt and the answer it awaits, by the ids its receipt gave: what a save writes,
 * and what the chat shows when the save failed so the prompt can still be cancelled.
 */
export default function promptPair({
	conversationId,
	parentId,
	content,
	promptMessageId,
	answerMessageId,
	now = Date.now(),
}: PromptPairInput): { finalUserMessage: Message; finalAiMessage: Message } {
	const finalUserMessage: Message = {
		id: promptMessageId,
		conversationId,
		parentId: parentId ?? undefined,
		role: 'user',
		content,
		createdAt: now,
	};
	const finalAiMessage: Message = {
		id: answerMessageId,
		conversationId,
		parentId: finalUserMessage.id,
		role: 'assistant',
		content: null,
		createdAt: now + 1,
		reasoning: [],
	};
	return { finalUserMessage, finalAiMessage };
}
