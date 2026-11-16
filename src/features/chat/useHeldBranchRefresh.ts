import { useEffect, useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';

import { type ComposerState, isWaitingForBranchHistory } from './promptParent';

// How often a held branch's messages are read again from the local store, and how often a
// sync is asked for. The first is a local read; the second is a query to the index, so it is
// the slower of the two.
export const HELD_BRANCH_REREAD_MS = 15_000;
export const HELD_BRANCH_RESYNC_MS = 60_000;

interface HeldBranchRefreshInput {
	composerKind: ComposerState['kind'];
	activeConversationId: string | number | null | undefined;
	ownerAddress: string | null | undefined;
	sessionKey: CryptoKey | null | undefined;
	queryClient: QueryClient;
}

/**
 * While a branch is held for its history, asks again for what would end the hold.
 *
 * A held branch is waiting for its original's messages. They arrive with a sync, which nothing
 * else would start while the composer cannot send; and nothing re-reads this branch's messages
 * when they do. So both are asked for again, each on its own timer.
 *
 * @returns Whether the conversation is waiting for its history. This stays true through the
 *          re-reads (see `isWaitingForBranchHistory`), so the timers and anything shown for
 *          the wait are not restarted by them.
 */
export default function useHeldBranchRefresh({
	composerKind,
	activeConversationId,
	ownerAddress,
	sessionKey,
	queryClient,
}: HeldBranchRefreshInput): boolean {
	const conversationKey = activeConversationId == null ? null : String(activeConversationId);
	// Kept with the conversation it belongs to, so that opening another conversation, which
	// starts in `loading`, does not inherit the wait.
	const [wait, setWait] = useState<{ conversationKey: string | null; isWaiting: boolean }>({
		conversationKey,
		isWaiting: false,
	});
	const wasWaiting = wait.conversationKey === conversationKey && wait.isWaiting;
	const isWaiting = isWaitingForBranchHistory(wasWaiting, composerKind);
	if (wait.conversationKey !== conversationKey || wait.isWaiting !== isWaiting) {
		// Adjusting state while rendering: React runs this render again at once with the new
		// state, before any effect, so there is no render in which the wait is out of date.
		setWait({ conversationKey, isWaiting });
	}

	useEffect(() => {
		if (!isWaiting) return undefined;
		const rereadMessages = setInterval(() => {
			queryClient.invalidateQueries({ queryKey: ['messages', activeConversationId, ownerAddress] });
		}, HELD_BRANCH_REREAD_MS);
		const resync = setInterval(() => {
			queryClient.invalidateQueries({ queryKey: ['conversations', sessionKey, ownerAddress] });
		}, HELD_BRANCH_RESYNC_MS);
		return () => {
			clearInterval(rereadMessages);
			clearInterval(resync);
		};
	}, [isWaiting, queryClient, activeConversationId, ownerAddress, sessionKey]);

	return isWaiting;
}
