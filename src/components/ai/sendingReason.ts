/**
 * Why a control that sends a paid prompt is off while another prompt is being sent. It is
 * shown and read as the control's description, as a switched-off reason is.
 */
const SENDING_REASON =
	'A prompt is being sent. Confirm or reject it in your wallet, then wait until it is confirmed.';

export default SENDING_REASON;

/** When a hold on a prompt ends: what every prompt hold says. */
const PROMPT_HOLD_ENDS =
	'This comes back once that prompt is back in your history or, at the latest, an hour after it was sent, when a refund can be claimed. Nothing is paid for twice.';

/**
 * Why regenerate and branch are off on an answer whose paid request (a prompt threaded off
 * it, or a new answer asked for) was confirmed but not saved on this device: a second press
 * would pay again for what is already on the chain.
 */
export const UNSAVED_SEND_REASON = `A paid request from this answer is on the chain but not saved on this device yet. ${PROMPT_HOLD_ENDS}`;

/**
 * The same for a branch, which has no answer to wait for and no refund (its fee is paid
 * directly): it is listed once indexed.
 */
export const UNSAVED_BRANCH_REASON =
	'A paid branch from this message is on the chain but not saved on this device yet. It appears in your history once it is listed, and this comes back then or, at the latest, an hour after it was sent. Nothing is paid for twice.';

/** Why edit and its save are off: saving an edit sends a paid prompt. */
export const UNSAVED_EDIT_REASON = `A paid prompt in this conversation is on the chain but not saved on this device yet, and saving an edit sends a paid prompt. ${PROMPT_HOLD_ENDS}`;

/** What the composer says while its conversation holds such a send. */
export const UNSAVED_SEND_COMPOSER_REASON = `Your last paid prompt here is on the chain but not saved on this device yet, so nothing is threaded off the wrong message. ${PROMPT_HOLD_ENDS}`;

/** What the new-chat composer says when the send started another conversation. */
export const UNSAVED_NEW_CONVERSATION_REASON = `Your last paid prompt started a new conversation that is on the chain but not saved on this device yet. ${PROMPT_HOLD_ENDS}`;
