import { isAnswerMessageId } from '@/lib/liveReasoning/contract';

/** The fields of a chat message this module reads. */
export interface MessageLike {
	id?: string | number | null;
	role?: string;
	content?: string | null;
	status?: string;
	answerMessageId?: string;
}

const isClosed = (m: MessageLike) => m.status === 'cancelled' || m.status === 'refunded';
const hasContent = (m: MessageLike) => m.content != null && m.content !== '';

/**
 * The answers of a conversation that are still awaited, by answer id: each content-less answer
 * placeholder (this device sent the prompt), and each pending prompt known only from the sync
 * (another device sent it) whose answer is not in the list yet. Cancelled and refunded ones
 * are not awaited.
 */
export function pendingAnswerIds(messages: readonly MessageLike[]): string[] {
	const assistantIds = new Set(
		messages.filter(m => m.role === 'assistant' && m.id != null).map(m => String(m.id)),
	);
	const placeholders = messages
		.filter(m => m.role === 'assistant' && !hasContent(m) && !isClosed(m))
		.map(m => String(m.id ?? ''));
	const synced = messages
		.filter(
			m =>
				m.role === 'user' &&
				m.status === 'pending' &&
				m.answerMessageId !== undefined &&
				!assistantIds.has(String(m.answerMessageId)),
		)
		.map(m => String(m.answerMessageId));
	return [...new Set([...placeholders, ...synced])].filter(isAnswerMessageId).sort();
}

/** The stored answer for an id, once it has content. */
export const storedAnswerFor = <T extends MessageLike>(
	messages: readonly T[],
	answerMessageId: string,
): T | undefined =>
	messages.find(m => m.role === 'assistant' && String(m.id) === answerMessageId && hasContent(m));
