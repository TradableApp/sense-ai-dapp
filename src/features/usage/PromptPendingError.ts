import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import { messageNamesError } from '@/lib/contractErrorSelector';

export const PROMPT_PENDING_TITLE = 'Prompt Pending';

const SET_PENDING =
	'A prompt is still pending, so nothing was sent. The plan can be changed once it is answered, cancelled or refunded.';

const REVOKE_PENDING =
	'A prompt is still pending, so the plan was not revoked and still stands. It can be revoked once the prompt is answered, cancelled or refunded.';

/** The words for a plan change the escrow refuses, or would refuse, for a pending prompt. */
export function promptPendingMessage(change: 'set' | 'revoke'): string {
	return change === 'set' ? SET_PENDING : REVOKE_PENDING;
}

/**
 * Whether `error` is the escrow refusing a plan change for a pending prompt, recognised by the
 * error's name (a local node writes it into the message) or by its selector (a public node
 * returns only the revert data).
 */
export function isPendingPromptsRefusal(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return messageNamesError(message, EVMAIAgentEscrowABI.abi, 'HasPendingPrompts');
}

/**
 * Setting a plan was asked for while the escrow holds one of the wallet's prompts pending: the
 * escrow would refuse the limit after the approval had gone through, so nothing is sent.
 * Thrown before anything is built.
 */
export default class PromptPendingError extends Error {
	constructor() {
		super(SET_PENDING);
		this.name = 'PromptPendingError';
	}
}
