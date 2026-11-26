import { CANCEL_ACTION } from '@/lib/feeTokenRefusal';
import { GAS_ONLY, METADATA_ACTION } from '@/lib/revertedTransaction';

/**
 * A transaction that was mined without reverting but whose receipt does not carry the
 * contract's own event for what was asked, so the contract did not do it.
 */
export class NotRecordedError extends Error {
	readonly action: string;

	constructor(action: string) {
		super(`The transaction to ${action} was mined, but the contract recorded nothing for it.`);
		this.name = 'NotRecordedError';
		this.action = action;
	}
}

const NOT_RECORDED_WORDS: Record<string, { title: string; description: string }> = {
	[CANCEL_ACTION]: {
		title: 'Not Cancelled',
		description: `The transaction went through, but the escrow recorded no cancellation for this prompt, so nothing was cancelled. ${GAS_ONLY} The prompt may have been answered meanwhile; if it is still waiting, it can be refunded one hour after it was sent.`,
	},
	[METADATA_ACTION]: {
		title: 'Not Changed',
		description: `The transaction went through, but the change was not recorded for this conversation, so it was not renamed or deleted. ${GAS_ONLY}`,
	},
};

/** For an action with no words of its own: it went through, so it is never called reverted. */
const NOT_RECORDED_FALLBACK = {
	title: 'Nothing Changed',
	description: `The transaction went through, but the contract recorded nothing for it, so nothing changed. ${GAS_ONLY}`,
};

/** What the user is told when the transaction for `action` went through and did nothing. */
export function notRecordedMessage(action: string): { title: string; description: string } {
	return NOT_RECORDED_WORDS[action] ?? NOT_RECORDED_FALLBACK;
}
