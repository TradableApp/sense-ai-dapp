/**
 * The remote switch that closes paid actions for one network and agent, read from a
 * document only the owner can write. Pure: what a reading means, the document's id, the
 * words shown for each reason, and the saved closure. The listener is in
 * `promptsSwitchSource.ts`; the decision whether an action may go ahead is in
 * `paymentGate.ts`.
 *
 * Nothing written in the document is ever shown: a reason is one of a few codes, and the
 * words for each live here. A document that cannot be read as the switch closes, because
 * someone wrote it on purpose; a document that cannot be reached changes nothing, because
 * an outage must not stop every payment.
 */
import describeShape from '@/lib/settingShape';

export const SWITCH_REASONS = ['pair-retired', 'maintenance', 'incident'] as const;
export type SwitchReason = (typeof SWITCH_REASONS)[number];

/** What a closed switch says: the words for a known reason, or the generic words. */
export const SWITCH_WORDINGS = [...SWITCH_REASONS, 'generic'] as const;
export type SwitchWording = (typeof SWITCH_WORDINGS)[number];

/**
 * `unknown`: nothing has been heard from the server and nothing was saved. It stops nothing,
 * like the fee token check's `unknown`.
 */
export type PromptsSwitchState =
	| { status: 'open' }
	| { status: 'closed'; wording: SwitchWording }
	| { status: 'unknown' };

type ConfirmedState = Exclude<PromptsSwitchState, { status: 'unknown' }>;
export type ClosedState = Extract<PromptsSwitchState, { status: 'closed' }>;

export const SWITCH_OPEN: PromptsSwitchState = Object.freeze({ status: 'open' });
export const SWITCH_UNKNOWN: PromptsSwitchState = Object.freeze({ status: 'unknown' });

/** Why a document the server confirmed is reported: it closes, but not as written. */
export type SwitchFault = 'malformed' | 'unknown-reason';

/** What the listener hands over: whether the document exists, and whether the server said so. */
export interface SwitchSnapshot {
	exists: boolean;
	/** True when the answer came from the local cache, not from the server. */
	fromCache: boolean;
	data: unknown;
}

export type SwitchReading =
	| { confirmed: false }
	| { confirmed: true; state: ConfirmedState; fault: SwitchFault | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isReason = (value: unknown): value is SwitchReason =>
	typeof value === 'string' && (SWITCH_REASONS as readonly string[]).includes(value);

const closedAs = (wording: SwitchWording): ClosedState => ({ status: 'closed', wording });

function readDocument(data: unknown): SwitchReading {
	if (!isRecord(data) || typeof data.closed !== 'boolean') {
		return { confirmed: true, state: closedAs('generic'), fault: 'malformed' };
	}
	if (!data.closed) return { confirmed: true, state: { status: 'open' }, fault: null };
	if (isReason(data.reason)) return { confirmed: true, state: closedAs(data.reason), fault: null };
	// A reason this build does not know is most likely a newer one: closed, in general words.
	const fault = typeof data.reason === 'string' ? 'unknown-reason' : 'malformed';
	return { confirmed: true, state: closedAs('generic'), fault };
}

/**
 * What a snapshot of the document means. Only the server's word counts: a cached answer
 * (offline, or before the server has replied) confirms nothing, and the caller keeps the
 * last state it had. A document the server says is absent is open; one that is present
 * but cannot be read closes, in generic words, and is a fault to report.
 */
export function parseSwitchSnapshot(snapshot: SwitchSnapshot): SwitchReading {
	if (snapshot.fromCache) return { confirmed: false };
	if (!snapshot.exists) return { confirmed: true, state: { status: 'open' }, fault: null };
	return readDocument(snapshot.data);
}

export const isClosed = (state: PromptsSwitchState): state is ClosedState =>
	state.status === 'closed';

const CHAIN_ID = /^[1-9][0-9]*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The document for one chain and agent, `{chainId}_{agentLowercase}`, or null when the build
 * names no usable chain or agent: then there is nothing to listen to.
 */
export function switchDocId(chainId: unknown, agentAddress: unknown): string | null {
	const chain = typeof chainId === 'number' ? String(chainId) : chainId;
	if (typeof chain !== 'string' || !CHAIN_ID.test(chain)) return null;
	if (typeof agentAddress !== 'string' || !ADDRESS.test(agentAddress)) return null;
	return `${chain}_${agentAddress.toLowerCase()}`;
}

/** Where a confirmed closure is saved, so it holds through a reload made offline. */
export const savedSwitchKey = (docId: string) => `senseai:promptsSwitch:${docId}`;

export const serialiseClosed = (state: ClosedState): string =>
	JSON.stringify({ closed: true, wording: state.wording });

/** A saved closure, or null for anything else: a value this build did not write is ignored. */
export function parseSavedSwitch(raw: string | null): ClosedState | null {
	if (raw === null) return null;
	try {
		const saved: unknown = JSON.parse(raw);
		if (!isRecord(saved) || saved.closed !== true) return null;
		const { wording } = saved;
		if (typeof wording !== 'string') return null;
		return (SWITCH_WORDINGS as readonly string[]).includes(wording)
			? closedAs(wording as SwitchWording)
			: null;
	} catch {
		return null;
	}
}

function fieldShape(value: unknown): string {
	if (value === undefined) return 'missing';
	if (value === null) return 'null';
	if (typeof value === 'boolean') return 'yes or no';
	if (typeof value === 'string') return `text (${describeShape(value)})`;
	if (Array.isArray(value)) return 'a list';
	return typeof value;
}

/**
 * The document's shape for a report, never its values: whoever wrote it may have pasted
 * anything into it. Fields other than `closed` and `reason` are counted, not named.
 */
export function describeSwitchDocument(data: unknown): string {
	if (data === undefined) return 'no data';
	if (!isRecord(data)) return 'not an object';
	const others = Object.keys(data).filter(
		key => key !== 'closed' && key !== 'reason' && key !== 'updatedAt',
	).length;
	const fields = `closed: ${fieldShape(data.closed)}; reason: ${fieldShape(data.reason)}`;
	return others > 0 ? `${fields}; ${others} other field${others === 1 ? '' : 's'}` : fields;
}

export type Notice = { title: string; description: string };

const CLOSED_ACTIONS = 'New prompts, branches, renames, deletes and new plans';
const MONEY_BACK_WORKS = 'Cancelling a prompt, claiming a refund and revoking a plan still work.';
// Beside a fee token notice, which may say a refund would be refused, "still work" could be
// untrue; what stays true is that the closure is not what stops them. No position words:
// these words also reach toasts and dialogs.
const MONEY_BACK_UNAFFECTED =
	'The closure does not affect cancelling a prompt, claiming a refund or revoking a plan; the other notice on this page says what else is wrong.';
// Not "goes away by itself": a tab whose listener keeps failing never hears the reopening.
const WHEN_IT_REOPENS =
	'This notice is removed when prompts reopen; if it is still here later, reload the page.';

const SWITCH_WORDS: Record<SwitchWording, { title: string; lead: string; tail?: string }> = {
	'pair-retired': {
		title: 'Prompts are closed on this version',
		lead: `SenseAI is moving to new contracts. ${CLOSED_ACTIONS} are closed on this version of the app.`,
		tail: 'Reload the page later to get the version that uses the new contracts.',
	},
	maintenance: {
		title: 'Prompts are closed for maintenance',
		lead: `SenseAI is closed for maintenance. ${CLOSED_ACTIONS} are switched off until it reopens.`,
		tail: WHEN_IT_REOPENS,
	},
	incident: {
		title: 'Prompts are paused',
		lead: `SenseAI has paused prompts while we look into a problem. ${CLOSED_ACTIONS} are switched off until it reopens.`,
		tail: WHEN_IT_REOPENS,
	},
	generic: {
		title: 'Prompts are closed for now',
		lead: `SenseAI has closed prompts for now. ${CLOSED_ACTIONS} are switched off until it reopens.`,
		tail: `${WHEN_IT_REOPENS} If it stays after a reload, tell us through Support in the menu.`,
	},
};

/**
 * The words for a closed switch. `otherProblem` is set when a fee token notice shows beside
 * it, so the two never contradict each other about getting money back.
 */
export function switchCopy(
	wording: SwitchWording,
	{ otherProblem = false }: { otherProblem?: boolean } = {},
): Notice {
	// A wording this build does not know cannot reach here (the reading maps it to generic);
	// the fallback keeps a hand-built state from rendering nothing.
	const words = SWITCH_WORDS[wording] ?? SWITCH_WORDS.generic;
	const moneyBack = otherProblem ? MONEY_BACK_UNAFFECTED : MONEY_BACK_WORKS;
	return {
		title: words.title,
		description: [words.lead, moneyBack, words.tail].filter(Boolean).join(' '),
	};
}
