import type { QueryClient } from '@tanstack/react-query';

interface UnsavedSendHoldInput {
	queryClient: QueryClient;
	activeConversationId: string | number | null | undefined;
	ownerAddress: string | null | undefined;
	/** The active conversation's messages as stored on this device (the messages query). */
	storedMessages: readonly { id?: string | number | null }[] | undefined;
	/** The stored conversation list. */
	conversations: readonly { id?: string | number | null }[] | undefined;
}

export interface UnsavedSendHold {
	isComposerHeld: boolean;
	heldReasonFor: (_answerId: string | number | null | undefined) => string | null;
}

export default function useUnsavedSendHold(_input: UnsavedSendHoldInput): UnsavedSendHold {
	return { isComposerHeld: false, heldReasonFor: () => null };
}
