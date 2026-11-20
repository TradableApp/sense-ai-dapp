/**
 * Whether the chain agrees with the token this build is for.
 *
 * The fee token is a build setting, and the escrow stores its own token once, when it is
 * initialised. Nothing ties the two together, so a build pointed at the wrong pair would ask
 * users to approve a token the escrow never takes. A token with restricted transfers adds a
 * second way to fail: unless its owner has listed the escrow and the treasury, payments are
 * refused. This reads both and says which it is.
 *
 * It guards against a mistake in setting up a build or a deployment. It is not a defence
 * against a hostile build: the addresses it checks come from the same build as the check.
 */
import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';

export type FeeTokenVerdict =
	| 'ok'
	| 'escrow-uses-other-token'
	| 'symbol-mismatch'
	| 'escrow-not-exempt'
	| 'treasury-not-exempt'
	| 'escrow-serves-other-agent'
	| 'contract-not-found'
	| 'token-paused';

/** The escrow's getter for the agent contract it serves. */
export const ESCROW_AGENT_GETTER = 'evmAIAgent';

/** `unknown`: the check has not answered, or could not. Nothing is stopped for it. */
export type FeeTokenCheckState = FeeTokenVerdict | 'unknown';

interface PairReadings {
	/** The token address this build was given. */
	configuredToken: string;
	/** The token the escrow stores. */
	escrowToken: string;
	onChainSymbol: string;
	/** The symbol of the profile this build selected. */
	expectedSymbol: string;
}

/** A token that moves only to or from listed addresses carries the two listings. */
export type FeeTokenReadings = PairReadings &
	({ restricted: false } | { restricted: true; escrowExempt: boolean; treasuryExempt: boolean });

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameSymbol = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The first thing wrong, in the order a user would meet it: the wrong token before anything
 * read from that token, and the escrow before the treasury because no payment works
 * without it. A listing that is anything but a plain yes counts as not listed.
 */
export function assessFeeToken(readings: FeeTokenReadings): FeeTokenVerdict {
	if (!sameAddress(readings.escrowToken, readings.configuredToken)) {
		return 'escrow-uses-other-token';
	}
	if (!sameSymbol(readings.onChainSymbol, readings.expectedSymbol)) return 'symbol-mismatch';
	if (!readings.restricted) return 'ok';
	if (readings.escrowExempt !== true) return 'escrow-not-exempt';
	if (readings.treasuryExempt !== true) return 'treasury-not-exempt';
	return 'ok';
}

/**
 * What a user pays for. Regenerating and resending an edited prompt are `prompt`; renaming
 * and deleting a conversation are `metadata`. Cancelling and refunding are not here: getting
 * money back is never switched off.
 */
export const PAID_ACTIONS = ['prompt', 'plan', 'branch', 'metadata'] as const;
export type PaidAction = (typeof PAID_ACTIONS)[number];

const DIRECT_FEES: readonly PaidAction[] = ['branch', 'metadata'];

/**
 * Whether an action would fail under a verdict. A prompt goes from the user to the escrow
 * and on to the treasury, and a restricted token allows a transfer when either end is
 * listed, so an unlisted treasury stops only the fees paid straight to it. Every other
 * disagreement stops everything.
 */
export function blocksAction(state: FeeTokenCheckState, action: PaidAction): boolean {
	if (state === 'ok' || state === 'unknown') return false;
	if (state === 'treasury-not-exempt') return DIRECT_FEES.includes(action);
	return true;
}

/** The contract reads the check needs. Kept this narrow so a test can stand in for the chain. */
export interface FeeTokenReader {
	escrow: (
		_method: typeof ESCROW_FEE_TOKEN_GETTER | typeof ESCROW_AGENT_GETTER | 'treasury',
	) => Promise<unknown>;
	token: (
		_method: 'symbol' | 'paused' | 'isTransferExempt',
		_params?: readonly [string],
	) => Promise<unknown>;
	/** The code the node holds at an address, read fresh each time. */
	code: (_address: string) => Promise<unknown>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function unreadable(what: string): Error {
	const error = new Error(`Fee token check: ${what}.`);
	error.name = 'FeeTokenCheckError';
	return error;
}

function asAddress(value: unknown, what: string): string {
	if (typeof value !== 'string' || !ADDRESS.test(value)) {
		throw unreadable(`${what} is not an address`);
	}
	return value;
}

const HEX = /^0x[0-9a-fA-F]*$/;
const NO_CODE = /^0x0*$/;

/**
 * Whether nothing is deployed at an address. A call to such an address "succeeds" and
 * returns nothing, so without this a wrong address reads as an unreachable node. Only an
 * empty answer means no contract; anything that is not hex is no answer at all.
 */
async function hasNoCode(reader: FeeTokenReader, address: string, what: string): Promise<boolean> {
	const code = await reader.code(address);
	if (typeof code !== 'string' || !HEX.test(code)) {
		throw unreadable(`the code at ${what} is not hex`);
	}
	return NO_CODE.test(code);
}

function asBoolean(value: unknown, what: string): boolean {
	if (typeof value !== 'boolean') throw unreadable(`${what} is not yes or no`);
	return value;
}

interface VerdictInput {
	reader: FeeTokenReader;
	configuredToken: string;
	/** The agent contract this build sends prompts to. */
	configuredAgent: string;
	escrowAddress: string;
	profile: { symbol: string; transferable: boolean; pausable: boolean };
}

/**
 * The escrow's side: that it exists, the token it takes, then the agent it serves. Null when both are the
 * ones the build names. A wrong token is named first, and nothing is asked after it.
 */
async function readEscrowSide({
	reader,
	configuredToken,
	configuredAgent,
	escrowAddress,
}: VerdictInput): Promise<FeeTokenVerdict | null> {
	if (await hasNoCode(reader, escrowAddress, 'the escrow')) return 'contract-not-found';
	const escrowToken = asAddress(await reader.escrow(ESCROW_FEE_TOKEN_GETTER), 'the escrow token');
	if (!sameAddress(escrowToken, configuredToken)) return 'escrow-uses-other-token';
	// A payment to an escrow wired to another agent is taken, and the answer is never seen.
	const agent = asAddress(await reader.escrow(ESCROW_AGENT_GETTER), 'the agent');
	if (!sameAddress(agent, configuredAgent)) return 'escrow-serves-other-agent';
	return null;
}

/**
 * The token's side: that it exists, its symbol, whether it is paused, then, for a restricted token, whether the escrow and the
 * treasury the escrow holds are listed. A build for a restricted token pointed at an
 * ordinary one cannot be asked about listings at all (that read reverts), and its symbol
 * is the answer; asked together, the revert would hide it.
 */
async function readTokenSide({
	reader,
	configuredToken,
	escrowAddress,
	profile,
}: VerdictInput): Promise<FeeTokenVerdict> {
	if (await hasNoCode(reader, configuredToken, 'the token')) return 'contract-not-found';
	const rawSymbol = await reader.token('symbol');
	if (typeof rawSymbol !== 'string') throw unreadable('the symbol is not text');
	const pair: PairReadings = {
		configuredToken,
		escrowToken: configuredToken,
		onChainSymbol: rawSymbol,
		expectedSymbol: profile.symbol,
	};
	if (!sameSymbol(rawSymbol, profile.symbol)) return 'symbol-mismatch';
	// A paused token refuses every movement, whoever is listed: the pause is the answer.
	if (profile.pausable && asBoolean(await reader.token('paused'), 'the pause flag')) {
		return 'token-paused';
	}
	if (profile.transferable) return assessFeeToken({ ...pair, restricted: false });

	const treasury = asAddress(await reader.escrow('treasury'), 'the treasury');
	const [rawEscrowExempt, rawTreasuryExempt] = await Promise.all([
		reader.token('isTransferExempt', [escrowAddress]),
		reader.token('isTransferExempt', [treasury]),
	]);
	return assessFeeToken({
		...pair,
		restricted: true,
		escrowExempt: asBoolean(rawEscrowExempt, 'the escrow exemption'),
		treasuryExempt: asBoolean(rawTreasuryExempt, 'the treasury exemption'),
	});
}

/**
 * Reads the chain and returns the verdict. A read that fails, or returns something that is
 * not what the contract declares, throws: no answer is not the same as a wrong token, and
 * the caller must not switch payments off for it.
 *
 * The reads are made in the order the verdicts are decided, one at a time, each decided
 * before the next is made: a later read that fails must not take away an answer an
 * earlier one already gave.
 */
export async function readFeeTokenVerdict(input: VerdictInput): Promise<FeeTokenVerdict> {
	return (await readEscrowSide(input)) ?? readTokenSide(input);
}

const EVERYTHING = 'Prompts, branches, renames, deletes and plan changes are switched off';
const GET_HELP =
	'If this message stays after you reload the page, tell us through Support in the menu. We will never ask for your recovery phrase.';

/**
 * What the user is told for a state that stops something; null when nothing is stopped. It
 * says what is off now and makes no claim about what the wallet approved or paid before.
 */
export function feeTokenBlockCopy(
	state: FeeTokenCheckState,
	symbol: string,
): { title: string; description: string } | null {
	switch (state) {
		case 'ok':
		case 'unknown':
			return null;
		case 'escrow-uses-other-token':
		case 'symbol-mismatch':
			return {
				title: 'Payments are switched off',
				description: `This version of the app and the SenseAI payment contract are not set up for the same token. ${EVERYTHING} while this message shows. ${GET_HELP}`,
			};
		case 'escrow-not-exempt':
			return {
				title: 'Payments are switched off',
				description: `The SenseAI payment contract cannot receive ${symbol} yet, so a payment would be refused. ${EVERYTHING} until this is fixed. ${GET_HELP}`,
			};
		case 'treasury-not-exempt':
			return {
				title: 'Some actions are switched off',
				description: `The fee for a branch, a rename or a delete cannot be received yet and would be refused, so those are switched off until this is fixed. Prompts still work. Cancelling a prompt may be refused; one that is not answered can be refunded after an hour. ${GET_HELP}`,
			};
		default:
			return null;
	}
}

/** Thrown by a paying action that the check has switched off, before anything is sent. */
export class FeeTokenBlockedError extends Error {
	readonly state: FeeTokenCheckState;

	constructor(state: FeeTokenCheckState) {
		super('This action is switched off: the fee token check did not pass.');
		this.name = 'FeeTokenBlockedError';
		this.state = state;
	}
}
