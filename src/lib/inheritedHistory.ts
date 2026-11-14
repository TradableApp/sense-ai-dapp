import type { Message } from './types';

/**
 * The messages a branch inherits: the path from the original's first message to the branch
 * point, oldest first, copied under the branch's id.
 *
 * A branch keeps only what was created in it, on chain and in the index. Everything before the
 * branch point belongs to the original, so a device that did not create the branch rebuilds it
 * from the original's messages by following `parentId` back from the branch point. Messages
 * added to the original afterwards, and other versions off that path, are not on it.
 *
 * Returns nothing when the branch point is not among `parentMessages`. A missing parent ends
 * the walk with what was reached; a loop in the parent links ends it too.
 */
export default function inheritedHistory(
	parentMessages: Message[],
	branchPointMessageId: string,
	branchConversationId: string,
): Message[] {
	const byId = new Map(parentMessages.map(message => [message.id, message]));
	const path: Message[] = [];
	const seen = new Set<string>();

	let currentId: string | undefined = branchPointMessageId;
	while (currentId && byId.has(currentId) && !seen.has(currentId)) {
		seen.add(currentId);
		const message = byId.get(currentId) as Message;
		path.unshift({ ...message, conversationId: branchConversationId });
		currentId = message.parentId;
	}

	return path;
}
