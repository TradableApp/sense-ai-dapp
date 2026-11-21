import { useCallback, useEffect, useMemo } from 'react';

import type { QueryClient } from '@tanstack/react-query';

import {
	UNSAVED_BRANCH_REASON,
	UNSAVED_EDIT_REASON,
	UNSAVED_NEW_CONVERSATION_REASON,
	UNSAVED_SEND_COMPOSER_REASON,
	UNSAVED_SEND_REASON,
} from '@/components/ai/sendingReason';

import {
	endShownSends,
	NEW_CONVERSATION_KEY,
	type UnsavedSend,
	useUnsavedSends,
} from './unsavedSends';

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
	/** Why the composer is held, worded for where the send was made; null when it is not. */
	composerHoldReason: string | null;
	/** Why edit and its save are off in this conversation; null when they are not. */
	editHeldReason: string | null;
	heldReasonFor: (_answerId: string | number | null | undefined) => string | null;
}

/** Why the composer is held, or null: "here", or a send that started another conversation. */
function composerReason(holds: readonly UnsavedSend[], conversationKey: string | null) {
	const key = conversationKey ?? NEW_CONVERSATION_KEY;
	if (!holds.some(send => send.composerKeys.includes(key))) return null;
	return conversationKey ? UNSAVED_SEND_COMPOSER_REASON : UNSAVED_NEW_CONVERSATION_REASON;
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

	const composerHoldReason = composerReason(holds, conversationKey);
	// Saving an edit sends a paid prompt in this conversation, so it is held with the composer.
	const editHeldReason = conversationKey && composerHoldReason ? UNSAVED_EDIT_REASON : null;
	const heldReasonFor = useCallback(
		(answerId: string | number | null | undefined) => {
			if (answerId == null) return null;
			const held = holds.find(
				send =>
					send.answer?.conversationKey === conversationKey &&
					send.answer.answerId === String(answerId),
			);
			if (!held) return null;
			return held.kind === 'branch' ? UNSAVED_BRANCH_REASON : UNSAVED_SEND_REASON;
		},
		[holds, conversationKey],
	);
	return {
		isComposerHeld: composerHoldReason !== null,
		composerHoldReason,
		editHeldReason,
		heldReasonFor,
	};
}
