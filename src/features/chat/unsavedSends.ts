import { useCallback, useSyncExternalStore } from 'react';

import type { QueryClient } from '@tanstack/react-query';

/** Which paid send it was (a prompt or an edit, regenerate, branch). */
export type SendKind = 'prompt' | 'regenerate' | 'branch';

/** The key the new-chat composer is held under: a new conversation has no id until sent. */
export const NEW_CONVERSATION_KEY = 'new';

/**
 * A paid send that was confirmed on chain but not saved on this device. See `holdUnsavedSend`.
 */
export interface UnsavedSend {
	owner: string;
	kind: SendKind;
	/** Conversations whose composer is held; `NEW_CONVERSATION_KEY` for the new-chat one. */
	composerKeys: readonly string[];
	/** The answer whose regenerate and branch are off, in its conversation. */
	answer: { conversationKey: string; answerId: string } | null;
	/** Ends the hold once this message is in this conversation's stored messages. */
	shownAs: { conversationKey: string; messageId: string } | null;
	/** Ends the hold once this conversation is in the stored list. */
	listedAs: string | null;
	/** Ends the hold when the wallet's pending count is seen to fall. */
	endsOnPendingFall: boolean;
}

export interface ShownNow {
	conversationKey: string | null;
	storedMessageIds: readonly string[];
	listedConversationIds: readonly string[];
}

/** What a send's variables and receipt say to hold, or null when they say nothing usable. */
export function unsavedSendFor(
	_kind: SendKind,
	_variables: unknown,
	_data: unknown,
	_owner: string,
): UnsavedSend | null {
	return null;
}

export function holdUnsavedSend(_queryClient: QueryClient, _send: UnsavedSend): void {}

export function endShownSends(_queryClient: QueryClient, _owner: string, _shown: ShownNow): void {}

export function endSendsOnPendingFall(_queryClient: QueryClient, _owner: string): void {}

const NONE: readonly UnsavedSend[] = [];

/** The unsaved sends held for `owner` in this query client. */
export function useUnsavedSends(
	_queryClient: QueryClient,
	_owner: string | null | undefined,
): readonly UnsavedSend[] {
	const subscribe = useCallback(() => () => undefined, []);
	return useSyncExternalStore(subscribe, () => NONE);
}
