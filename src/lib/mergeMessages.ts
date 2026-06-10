import type { Message } from './types';

/** True when a message carries delivered, non-empty content. */
function hasContent(message: Message): boolean {
	return typeof message.content === 'string' && message.content.length > 0;
}

/**
 * Merge the locally-cached messages with the latest set from The Graph, keyed by id.
 *
 * The Graph is authority for status and metadata, but a message's CONTENT comes from
 * decentralised-storage hydration (IPFS/Autonomys), not the Graph directly. So an
 * incoming message that the current sync cycle couldn't (re)hydrate arrives
 * content-less — and must NOT clobber content we already have cached. In that case we
 * take the incoming message's fields but retain the existing content. Messages present
 * only in the cache (older history the Graph didn't return) are preserved. The result
 * is sorted by createdAt.
 */
export default function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
	const byId = new Map<string, Message>();

	existing.forEach(message => {
		byId.set(message.id, message);
	});

	incoming.forEach(message => {
		const prev = byId.get(message.id);
		if (prev && !hasContent(message) && hasContent(prev)) {
			// Don't let an un-hydrated update wipe content we already delivered.
			byId.set(message.id, { ...message, content: prev.content });
		} else {
			byId.set(message.id, message);
		}
	});

	return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}
