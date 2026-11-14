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
	// Message ids are numeric strings ("53"). A missing id must not become 0, which is a real
	// id: Number(null) is 0, so it is replaced before parsing.
	const parsed = Number(last?.id ?? NaN);
	const parentId = Number.isFinite(parsed) ? parsed : null;

	if (parentId === null) {
		return hasBranchOrigin ? { kind: 'hold' } : { kind: 'parent', parentId: null, parentCID: null };
	}
	return { kind: 'parent', parentId, parentCID: last?.messageCID ?? null };
}
