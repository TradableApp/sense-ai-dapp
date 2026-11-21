import { useCallback, useEffect, useMemo } from 'react';

import type { QueryClient } from '@tanstack/react-query';

import { UNSAVED_SEND_REASON } from '@/components/ai/sendingReason';

import { endShownSends, NEW_CONVERSATION_KEY, useUnsavedSends } from './unsavedSends';

type WithId = { id?: string | number | null };

interface UnsavedSendHoldInput {
	queryClient: QueryClient;
	activeConversationId: string | number | null | undefined;
	ownerAddress: string | null | undefined;
	/** The active conversation's messages as stored on this device (the messages query). */
	storedMessages: readonly WithId[] | undefined;
	/** The stored conversation list. */
	conversations: readonly WithId[] | undefined;
}

export interface UnsavedSendHold {
	isComposerHeld: boolean;
	heldReasonFor: (_answerId: string | number | null | undefined) => string | null;
}

const idsOf = (items: readonly WithId[] | undefined) =>
	(items ?? []).flatMap(item => (item.id == null ? [] : [String(item.id)]));

/**
 * Whether the active conversation is held for a paid send that was confirmed but not saved
 * here, and which of its answers are; see `UnsavedSend`. The stored messages are read, not
 * what the chat shows: the chat shows such a prompt from its receipt, and that must not end
 * the hold.
 */
export default function useUnsavedSendHold({
	queryClient,
	activeConversationId,
	ownerAddress,
	storedMessages,
	conversations,
}: UnsavedSendHoldInput): UnsavedSendHold {
	const holds = useUnsavedSends(queryClient, ownerAddress);
	const conversationKey = activeConversationId ? String(activeConversationId) : null;
	const storedMessageIds = useMemo(() => idsOf(storedMessages), [storedMessages]);
	const listedConversationIds = useMemo(() => idsOf(conversations), [conversations]);

	useEffect(() => {
		if (!ownerAddress || holds.length === 0) return;
		endShownSends(queryClient, ownerAddress, {
			conversationKey,
			storedMessageIds,
			listedConversationIds,
		});
	}, [holds, queryClient, ownerAddress, conversationKey, storedMessageIds, listedConversationIds]);

	const composerKey = conversationKey ?? NEW_CONVERSATION_KEY;
	const isComposerHeld = holds.some(send => send.composerKeys.includes(composerKey));
	const heldReasonFor = useCallback(
		(answerId: string | number | null | undefined) =>
			answerId != null &&
			holds.some(
				send =>
					send.answer?.conversationKey === conversationKey &&
					send.answer.answerId === String(answerId),
			)
				? UNSAVED_SEND_REASON
				: null,
		[holds, conversationKey],
	);
	return { isComposerHeld, heldReasonFor };
}
