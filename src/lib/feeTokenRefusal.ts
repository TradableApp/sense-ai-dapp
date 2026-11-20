/**
 * What to tell the user when the fee token refuses a transfer, and why a control is
 * switched off. Worded from the fee token check's answer, never from a token's name.
 */
import type { FeeTokenCheckState } from '@/lib/feeTokenCheck';

/** The action names the error handler is given for getting money back. */
export const CANCEL_ACTION = 'cancel prompt';
export const REFUND_ACTION = 'process refund';

type Notice = { title: string; description: string };

/**
 * Whether a refund would get through. A refund goes from the escrow back to the user, and
 * a restricted token lets a transfer through only when one end is listed: users are not,
 * so it depends on the escrow. A state not listed here says nothing about the refund.
 */
const REFUND_OUTLOOK: Partial<Record<FeeTokenCheckState, 'works' | 'refused'>> = {
	'treasury-not-exempt': 'works',
	'escrow-not-exempt': 'refused',
};

const STILL_HELD =
	'The cancellation could not be completed, so your payment for this prompt is still held.';

const CANCEL_REFUSED: Record<'works' | 'refused' | 'uncertain', string> = {
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
	return {
		title: 'Payment Not Accepted',
		description:
			'SenseAI could not take this payment, so no tokens were taken. Please try again later or contact support.',
	};
}
