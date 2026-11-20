/**
 * What to tell the user when the fee token refuses a transfer, and why a control is
 * switched off. Worded from the fee token check's answer, never from a token's name.
 */
import { feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';

/** The action names the error handler is given for getting money back. */
export const CANCEL_ACTION = 'cancel prompt';
export const REFUND_ACTION = 'process refund';

type Notice = { title: string; description: string };

type RefundOutlook = 'works' | 'refused' | 'uncertain';

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
};

const STILL_HELD =
	'The cancellation could not be completed, so your payment for this prompt is still held.';

const CANCEL_REFUSED: Record<RefundOutlook, string> = {
	works: `${STILL_HELD} You can claim a refund one hour after the prompt was sent.`,
	refused: `${STILL_HELD} A refund would be refused too until this is fixed, so please contact support.`,
	uncertain: `${STILL_HELD} You can ask for a refund one hour after the prompt was sent; if that is refused too, please contact support.`,
};

/**
 * What to say when the token refuses a transfer, which depends on what was being done.
 * A refused payment took nothing. A refused cancellation leaves the prompt's fee held, and
 * whether the refund is the way out depends on what the check found. A refused refund also
 * took nothing, but the user is owed tokens and needs a person.
 */
export function refusedTransferMessage(
	action: string,
	verdict: FeeTokenCheckState = 'unknown',
): Notice {
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
	const title = feeTokenBlockCopy(state, symbol)?.title ?? 'This action is switched off';
	return `${title}. ${WHERE_THE_BANNER_IS[place]}`;
}
