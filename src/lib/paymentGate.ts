/**
 * The one place that decides whether a paying action may go ahead. Three things can stop it:
 * the fee token check (the chain disagrees with the token this build is for), the remote
 * prompts switch (the owner has closed prompts for this network and agent) and the oracle key
 * check (the key this build encrypts to is not the one the agent publishes, or none is
 * published). Every paying mutation, every control for one and the banner read this, never
 * any source alone.
 *
 * Cancelling, refunding and revoking a plan are not paid actions and never ask.
 */
import {
	blocksAction,
	feeTokenBlockCopy,
	type FeeTokenCheckState,
	type PaidAction,
} from '@/lib/feeTokenCheck';
import {
	oracleKeyBlockCopy,
	oracleKeyBlocks,
	type OracleKeyCheckState,
} from '@/lib/oracleKeyCheck';
import { isClosed, type Notice, type PromptsSwitchState, switchCopy } from '@/lib/promptsSwitch';

export interface PaymentGateState {
	feeToken: FeeTokenCheckState;
	prompts: PromptsSwitchState;
	oracleKey: OracleKeyCheckState;
}

/**
 * A closed switch stops every paid action; otherwise an action is stopped when the fee token
 * check or the oracle key check stops it.
 */
export function gateBlocks(state: PaymentGateState, action: PaidAction): boolean {
	return (
		isClosed(state.prompts) ||
		blocksAction(state.feeToken, action) ||
		oracleKeyBlocks(state.oracleKey, action)
	);
}

/** Which check a notice comes from: the banner tones each one and keys it by this. */
export type NoticeSource = 'switch' | 'feeToken' | 'oracleKey';

export interface GateSection {
	source: NoticeSource;
	notice: Notice;
	/** Whether this source stops `action`. */
	stops: (_action: PaidAction) => boolean;
}

/**
 * The banner's notices with where each comes from, in order; empty when nothing is stopped.
 *
 * The switch comes first: it is a decision someone made on purpose, it stops everything, and
 * it says why in words the owner chose. A fee token notice follows it, because it may say
 * something the switch does not (that a refund would be refused too, for one). The oracle key
 * notice comes last. The switch and the oracle key notice say that getting money back works
 * only when no fee token notice is beside them, since that notice may say otherwise.
 */
export function gateSections(state: PaymentGateState, symbol: string): GateSection[] {
	const fee = feeTokenBlockCopy(state.feeToken, symbol);
	const otherProblem = fee !== null;
	const oracle = oracleKeyBlockCopy(state.oracleKey, { otherProblem });
	const sections: GateSection[] = [];
	if (isClosed(state.prompts)) {
		sections.push({
			source: 'switch',
			notice: switchCopy(state.prompts.wording, { otherProblem }),
			stops: () => true,
		});
	}
	if (fee) {
		sections.push({
			source: 'feeToken',
			notice: fee,
			stops: action => blocksAction(state.feeToken, action),
		});
	}
	if (oracle) {
		sections.push({
			source: 'oracleKey',
			notice: oracle,
			stops: action => oracleKeyBlocks(state.oracleKey, action),
		});
	}
	return sections;
}

/** What the banner shows, in order; empty when nothing is stopped. See `gateSections`. */
export function gateCopy(state: PaymentGateState, symbol: string): Notice[] {
	return gateSections(state, symbol).map(section => section.notice);
}

/**
 * Why `action` is refused, in the words of the first notice whose source stops it (the
 * switch first); null if allowed. A notice that does not stop this action (an unlisted
 * treasury, for a prompt) is passed over, so its words never explain a refusal it did not
 * cause.
 */
export function gateNotice(
	state: PaymentGateState,
	action: PaidAction,
	symbol: string,
): Notice | null {
	if (!gateBlocks(state, action)) return null;
	return gateSections(state, symbol).find(section => section.stops(action))?.notice ?? null;
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
