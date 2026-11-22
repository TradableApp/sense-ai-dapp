import { REFUND_TIMEOUT_MS } from '@/lib/constants';
import { isAnswerMessageId } from '@/lib/liveReasoning/contract';

/** How long the stream server keeps a finished run's frames (its `STREAM_GRACE_MS` default). */
const STREAM_GRACE_MS = 120_000;

/**
 * The oldest prompt whose answer is followed live. The oracle answers a prompt while it is
 * pending, and after the refund window (`REFUND_TIMEOUT_MS`) the prompt is awaiting its refund;
 * a run that closes is kept by the server for `STREAM_GRACE_MS` and then answers 404 or 410.
 * Past both there is nothing left to read, and following would only ask again and again. An
 * answer that still comes later lands from the sync, as every answer does.
 */
export const FOLLOW_MAX_AGE_MS = REFUND_TIMEOUT_MS + STREAM_GRACE_MS;

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
