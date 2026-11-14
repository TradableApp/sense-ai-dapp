import type { Message } from './types';

/** A message's parent id as a string: a message written on the sending device can carry a number. */
const parentIdOf = (message: Message): string | undefined => {
	const { parentId }: { parentId?: unknown } = message;
	return parentId === undefined || parentId === null || parentId === ''
		? undefined
		: String(parentId);
};

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
	const byId = new Map(parentMessages.map(message => [String(message.id), message]));
	const path: Message[] = [];
	const seen = new Set<string>();

	let currentId: string | undefined = branchPointMessageId;
	while (currentId !== undefined && !seen.has(currentId)) {
		const message = byId.get(currentId);
		if (!message) break;
		seen.add(currentId);
		path.unshift({ ...message, conversationId: branchConversationId });
		currentId = parentIdOf(message);
	}

	return path;
}

/**
 * True when a path from `inheritedHistory` goes all the way back to a first message. A path
 * that stops short (a message the device does not hold yet) is a cut-off history: fine to show,
 * not to keep as the branch's history.
 */
export function reachesFirstMessage(path: Message[]): boolean {
	return path.length > 0 && parentIdOf(path[0]) === undefined;
}
