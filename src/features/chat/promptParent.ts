/**
 * What a new prompt threads off: the last message shown, or nothing in a conversation that has
 * no messages yet.
 *
 * A branch is the exception to "nothing". It always has history (the messages before its branch
 * point), so a branch that shows nothing is one whose history is not on this device yet. A
 * prompt sent then would have no parent, the answer would be stored as the start of a
 * conversation, and the branch would lose its link to where it came from. So the prompt is held
 * until there is a message to thread off.
 */
export type PromptParent =
	| { kind: 'parent'; parentId: number | null; parentCID: string | null }
	| { kind: 'hold' };

interface ShownMessage {
	id?: string | number | null;
	messageCID?: string | null;
}

export default function promptParentFor(
	messagesShown: readonly ShownMessage[] | undefined,
	{ hasBranchOrigin }: { hasBranchOrigin: boolean },
): PromptParent {
	const last = messagesShown?.at(-1);
	// Message ids are numeric strings ("53"). A missing or empty id must not become 0, which is
	// a real id: Number(null) and Number('') are both 0, so they are replaced before parsing.
	const id = last?.id;
	const parsed = id === null || id === undefined || id === '' ? NaN : Number(id);
	const parentId = Number.isFinite(parsed) ? parsed : null;

	if (parentId === null) {
		return hasBranchOrigin ? { kind: 'hold' } : { kind: 'parent', parentId: null, parentCID: null };
	}
	return { kind: 'parent', parentId, parentCID: last?.messageCID ?? null };
}

/**
 * Whether a prompt can be sent now, and what it threads off.
 *
 * - `ready`: send, with this parent.
 * - `loading`: the conversation's messages, or whether it is a branch, have not been read yet.
 *   Nothing is known, so nothing is sent and nothing is said: opening any conversation passes
 *   through this for the length of a local read.
 * - `hold`: everything has been read, the conversation is a branch and it shows nothing. Its
 *   history is not on this device; see `promptParentFor`.
 */
export type ComposerState =
	| { kind: 'ready'; parentId: number | null; parentCID: string | null; hasBranchOrigin: boolean }
	| { kind: 'loading' }
	| { kind: 'hold' };

interface ComposerInput {
	activeConversationId: string | number | null | undefined;
	/** The conversation's stored record, from whichever read has it; undefined when none does. */
	conversation: { branchedFromConversationId?: string | null } | null | undefined;
	/** The read that would find the record has finished. */
	isConversationSettled: boolean;
	messagesShown: readonly ShownMessage[] | undefined;
	/** The conversation's messages have been read and are what is shown. */
	areMessagesSettled: boolean;
}

export function composerStateFor({
	activeConversationId,
	conversation,
	isConversationSettled,
	messagesShown,
	areMessagesSettled,
}: ComposerInput): ComposerState {
	// No conversation yet: the prompt starts one.
	if (!activeConversationId) {
		return { kind: 'ready', parentId: null, parentCID: null, hasBranchOrigin: false };
	}
	// Whether it is a branch is unknown until its record is found or the read has finished
	// without one (a conversation whose only prompts were cancelled has no record).
	if (!conversation && !isConversationSettled) return { kind: 'loading' };

	const hasBranchOrigin = Boolean(conversation?.branchedFromConversationId);
	const parent = promptParentFor(messagesShown, { hasBranchOrigin });
	if (parent.kind === 'parent' && parent.parentId !== null) {
		return { ...parent, kind: 'ready', hasBranchOrigin };
	}
	// Nothing to thread off. Whether that is the whole truth is known only once the messages
	// have been read; a re-read with messages on screen never gets here, so typing is never
	// interrupted by one.
	if (!areMessagesSettled) return { kind: 'loading' };
	return parent.kind === 'hold' ? parent : { ...parent, kind: 'ready', hasBranchOrigin };
}

/**
 * Whether the composer is still waiting for a branch's history, given whether it was waiting
 * and what it has become.
 *
 * `hold` starts the wait and `ready` ends it. `loading` changes nothing: while held, the
 * messages are read again every few seconds and each read passes through `loading`, so ending
 * the wait there would restart, on every re-read, everything that runs for as long as the wait
 * lasts.
 */
export function isWaitingForBranchHistory(wasWaiting: boolean, kind: ComposerState['kind']) {
	if (kind === 'hold') return true;
	if (kind === 'ready') return false;
	return wasWaiting;
}
