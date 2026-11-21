/**
 * Why a control that sends a paid prompt is off while another prompt is being sent. It is
 * shown and read as the control's description, as a switched-off reason is.
 */
const SENDING_REASON =
	'A prompt is being sent. Confirm or reject it in your wallet, then wait until it is confirmed.';

export default SENDING_REASON;

/**
 * Why regenerate and branch are off on an answer whose paid send was confirmed but not saved
 * on this device: a second press would pay again for what is already on the chain.
 */
export const UNSAVED_SEND_REASON =
	'A paid request from this answer is on the chain but not shown on this device yet. This comes back once it appears or its answer arrives, so nothing is paid for twice.';

/** What the composer says while its conversation holds such a send. */
export const UNSAVED_SEND_COMPOSER_REASON =
	'Your last paid prompt here is on the chain but not shown on this device yet. You can send again once it appears or its answer arrives, so nothing is paid for twice or threaded off the wrong message.';

export const UNSAVED_BRANCH_REASON = '';
export const UNSAVED_EDIT_REASON = '';
export const UNSAVED_NEW_CONVERSATION_REASON = '';
