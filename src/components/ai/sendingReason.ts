/**
 * Why a control that sends a paid prompt is off while another prompt is being sent. It is
 * shown and read as the control's description, as a switched-off reason is.
 */
const SENDING_REASON =
	'A prompt is being sent. Confirm or reject it in your wallet, then wait until it is confirmed.';

export default SENDING_REASON;

/** Said by every hold, which lasts at most until the page is loaded again. */
const RELOAD_IF_IT_STAYS = 'If this stays, reload the page.';

/**
 * Why regenerate and branch are off on an answer whose paid request (a prompt threaded off
 * it, or a new answer asked for) was confirmed but not saved on this device: a second press
 * would pay again for what is already on the chain.
 */
export const UNSAVED_SEND_REASON = `A paid request from this answer is on the chain but not shown on this device yet. This comes back once it appears or its answer arrives, so nothing is paid for twice. ${RELOAD_IF_IT_STAYS}`;

/** The same for a branch, which has no answer to wait for: it is listed once indexed. */
export const UNSAVED_BRANCH_REASON = `A paid branch from this message is on the chain but not shown on this device yet. It appears in your history once it is listed, and this comes back then, so nothing is paid for twice. ${RELOAD_IF_IT_STAYS}`;

/** Why edit and its save are off: saving an edit sends a paid prompt. */
export const UNSAVED_EDIT_REASON = `A paid prompt in this conversation is on the chain but not shown on this device yet. Saving an edit sends a paid prompt, so it is off until that one appears or its answer arrives. ${RELOAD_IF_IT_STAYS}`;

/** What the composer says while its conversation holds such a send. */
export const UNSAVED_SEND_COMPOSER_REASON = `Your last paid prompt here is on the chain but not shown on this device yet. You can send again once it appears or its answer arrives, so nothing is paid for twice or threaded off the wrong message. ${RELOAD_IF_IT_STAYS}`;

/** What the new-chat composer says when the send started another conversation. */
export const UNSAVED_NEW_CONVERSATION_REASON = `Your last paid prompt started a new conversation that is on the chain but not shown on this device yet. You can start another once it appears or its answer arrives, so nothing is paid for twice. ${RELOAD_IF_IT_STAYS}`;
