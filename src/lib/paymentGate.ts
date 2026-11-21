/**
 * The one place that decides whether a paying action may go ahead. Two things can stop it:
 * the fee token check (the chain disagrees with the token this build is for) and the remote
 * prompts switch (the owner has closed prompts for this network and agent). Every paying
 * mutation, every control for one and the banner read this, never either source alone.
 *
 * Cancelling, refunding and revoking a plan are not paid actions and never ask.
 */
import {
	blocksAction,
	feeTokenBlockCopy,
	type FeeTokenCheckState,
	type PaidAction,
} from '@/lib/feeTokenCheck';
import { isClosed, type Notice, type PromptsSwitchState, switchCopy } from '@/lib/promptsSwitch';

export interface PaymentGateState {
	feeToken: FeeTokenCheckState;
	prompts: PromptsSwitchState;
}

/** A closed switch stops every paid action; otherwise the fee token check decides. */
export function gateBlocks(state: PaymentGateState, action: PaidAction): boolean {
	return isClosed(state.prompts) || blocksAction(state.feeToken, action);
}

/**
 * What the banner shows, in order; empty when nothing is stopped.
 *
 * The switch comes first: it is a decision someone made on purpose, it stops everything, and
 * it says why in words the owner chose. A fee token notice still follows it, because it may
 * say something the switch does not (that a refund would be refused too, for one).
 */
export function gateCopy(state: PaymentGateState, symbol: string): Notice[] {
	const fee = feeTokenBlockCopy(state.feeToken, symbol);
	const switchNotices = isClosed(state.prompts)
		? [switchCopy(state.prompts.wording, { otherProblem: fee !== null })]
		: [];
	return fee ? [...switchNotices, fee] : switchNotices;
}

/** Why `action` is refused, in the words of what stops it (the switch first); null if allowed. */
export function gateNotice(
	state: PaymentGateState,
	action: PaidAction,
	symbol: string,
): Notice | null {
	if (!gateBlocks(state, action)) return null;
	return gateCopy(state, symbol)[0] ?? null;
}

const FALLBACK_TITLE = 'This action is switched off';

/**
 * Thrown by a paying action the gate refuses, before anything is encrypted, prepared or
 * sent. Its message is the banner's words, so any place that shows it reads plainly.
 */
export class PaymentSwitchedOffError extends Error {
	readonly state: PaymentGateState;

	readonly notice: Notice;

	constructor(state: PaymentGateState, action: PaidAction, symbol: string) {
		// Null only if a caller throws for an allowed action; the words still say it is off.
		const notice = gateNotice(state, action, symbol) ?? { title: FALLBACK_TITLE, description: '' };
		super(notice.description ? `${notice.title}. ${notice.description}` : `${notice.title}.`);
		this.name = 'PaymentSwitchedOffError';
		this.state = state;
		this.notice = notice;
	}
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
 * Why a control is switched off, for its tooltip and its accessible description: the title
 * of what stops it, and where to read the rest.
 */
export function switchedOffReason(
	state: PaymentGateState,
	action: PaidAction,
	symbol: string,
	place: BannerPlace = 'page',
): string {
	const title = gateNotice(state, action, symbol)?.title ?? FALLBACK_TITLE;
	return `${title}. ${WHERE_THE_BANNER_IS[place]}`;
}
