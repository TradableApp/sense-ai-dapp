/**
 * What to tell the user when the fee token refuses a transfer, and why a control is
 * switched off. Worded from the fee token check's answer, never from a token's name.
 */
import { feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';

/** The action names the error handler is given for getting money back. */
export const CANCEL_ACTION = 'cancel prompt';
export const REFUND_ACTION = 'process refund';

type Notice = { title: string; description: string };

type RefundOutlook = 'works' | 'refused' | 'uncertain' | 'paused' | 'support';

/**
 * Whether a refund would get through. A refund goes from the escrow back to the user, and
 * a restricted token lets a transfer through only when one end is listed: users are not,
 * so it depends on the escrow. Every state has its row, so a verdict added to the check
 * fails to compile here until someone decides how a refused cancellation speaks of it.
 */
export const REFUND_OUTLOOK: Record<FeeTokenCheckState, RefundOutlook> = {
	// A refusal under a passing check means the check is the older fact: something changed on
	// chain since its last look, so the refund is not promised on its word.
	ok: 'uncertain',
	unknown: 'uncertain',
	'escrow-uses-other-token': 'uncertain',
	'symbol-mismatch': 'uncertain',
	'escrow-not-exempt': 'refused',
	'treasury-not-exempt': 'works',
	// Nothing on this device can say when a refund would work: no contract answers at an
	// address the app pays through, or the escrow serves another agent. No time is promised.
	'contract-not-found': 'support',
	'escrow-serves-other-agent': 'support',
	// A paused token refuses every movement, the refund included, until it is resumed.
	'token-paused': 'paused',
};

const STILL_HELD =
	'The cancellation could not be completed, so your payment for this prompt is still held.';

const CANCEL_REFUSED: Record<RefundOutlook, string> = {
	works: `${STILL_HELD} You can claim a refund one hour after the prompt was sent.`,
	refused: `${STILL_HELD} A refund would be refused too until this is fixed, so please contact support.`,
	uncertain: `${STILL_HELD} You can ask for a refund one hour after the prompt was sent; if that is refused too, please contact support.`,
	paused: `${STILL_HELD} The token is paused, so a refund would be refused too until it is resumed; your payment stays with the SenseAI payment contract until then.`,
	support: `${STILL_HELD} Please contact support so it can be returned.`,
};

/**
 * Why the token refused: a party to the transfer is not listed, or the token is paused.
 * A paused token refuses every movement until its owner resumes it.
 */
export type RefusalCause = 'restricted' | 'paused';

/**
 * What to say when a paused token refuses a transfer. The pause is the newer fact than any
 * verdict of the check, since the token reported it just now, so the verdict plays no part.
 * Nobody here knows when the token will be resumed, so no time is promised.
 */
function pausedTransferMessage(action: string): Notice {
	if (action === CANCEL_ACTION) {
		return {
			title: 'Could Not Cancel',
			description: `${STILL_HELD} The token is paused, so it stays with the SenseAI payment contract until the token is resumed; you can then cancel again or ask for a refund.`,
		};
	}
	if (action === REFUND_ACTION) {
		return {
			title: 'Refund Not Sent',
			description:
				'The token is paused, so the refund could not be sent and your payment is still held. Please try again once the token is resumed.',
		};
	}
	return {
		title: 'Payments Paused',
		description: 'Payments are paused for now, so no tokens were taken. Please try again later.',
	};
}

/**
 * What to say when the token refuses a transfer, which depends on what was being done.
 * A refused payment took nothing. A refused cancellation leaves the prompt's fee held, and
 * whether the refund is the way out depends on what the check found. A refused refund also
 * took nothing, but the user is owed tokens and needs a person. A paused token is worded by
 * action too, but waits for the token to be resumed rather than for a person.
 */
export function refusedTransferMessage(
	action: string,
	verdict: FeeTokenCheckState = 'unknown',
	cause: RefusalCause = 'restricted',
): Notice {
	if (cause === 'paused') return pausedTransferMessage(action);
	if (action === CANCEL_ACTION) {
		return {
			title: 'Could Not Cancel',
			// A state the build does not know (an answer from a newer check) is uncertain.
			description: CANCEL_REFUSED[REFUND_OUTLOOK[verdict] ?? 'uncertain'],
		};
	}
	if (action === REFUND_ACTION) {
		return {
			title: 'Refund Not Sent',
			description:
				'The refund could not be sent and your payment is still held. Please contact support.',
		};
	}
	// Any other action is a payment, and a refused payment took nothing. Kept as the default
	// rather than an exhaustive list: the actions are the error handler's free-text names, and
	// a new paying action must get this wording without a change here.
	return {
		title: 'Payment Not Accepted',
		description:
			'SenseAI could not take this payment, so no tokens were taken. Please try again later or contact support.',
	};
}

/**
 * Where the banner is, seen from the control: at the top of the page for a control on the
 * page, or above it for one in a dialog, whose backdrop hides the page's banner and which
 * therefore shows its own.
 */
export type BannerPlace = 'page' | 'dialog';

const WHERE_THE_BANNER_IS: Record<BannerPlace, string> = {
	page: 'The notice at the top of the page says why.',
	dialog: 'The notice above says why.',
};

/**
 * Why a control is switched off, for its tooltip and its accessible description: the
 * banner's title, and where to read the rest.
 */
export function switchedOffReason(
	state: FeeTokenCheckState,
	symbol: string,
	place: BannerPlace = 'page',
): string {
	// The banner copy is empty only for `ok` and `unknown`, which switch nothing off and so
	// never reach here. If this fallback is ever shown, a new state lacks its banner words.
	const title = feeTokenBlockCopy(state, symbol)?.title ?? 'This action is switched off';
	return `${title}. ${WHERE_THE_BANNER_IS[place]}`;
}
