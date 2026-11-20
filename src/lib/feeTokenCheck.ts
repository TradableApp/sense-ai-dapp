/**
 * Whether the chain agrees with the token this build is for.
 *
 * The fee token is a build setting, and the escrow stores its own token once, when it is
 * initialised. Nothing ties the two together, so a build pointed at the wrong pair would ask
 * users to approve a token the escrow never takes. A token with restricted transfers adds a
 * second way to fail: unless its owner has listed the escrow and the treasury, every payment
 * is refused after the user has paid gas for it. This reads both and says which it is.
 */

import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';

export type FeeTokenVerdict =
	| 'ok'
	| 'escrow-uses-other-token'
	| 'symbol-mismatch'
	| 'escrow-not-exempt'
	| 'treasury-not-exempt';

export interface FeeTokenReadings {
	/** The token address this build was given. */
	configuredToken: string;
	/** The token the escrow stores. */
	escrowToken: string;
	onChainSymbol: string;
	/** The symbol of the profile this build selected. */
	expectedSymbol: string;
	/** True for a token that moves only to or from listed addresses. */
	restricted: boolean;
	escrowExempt?: boolean;
	treasuryExempt?: boolean;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameSymbol = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The first thing wrong, in the order a user would meet it: the wrong token before anything
 * read from that token, and the escrow before the treasury because no payment works
 * without it.
 */
export function assessFeeToken(readings: FeeTokenReadings): FeeTokenVerdict {
	if (!sameAddress(readings.escrowToken, readings.configuredToken)) {
		return 'escrow-uses-other-token';
	}
	if (!sameSymbol(readings.onChainSymbol, readings.expectedSymbol)) return 'symbol-mismatch';
	if (!readings.restricted) return 'ok';
	if (readings.escrowExempt === false) return 'escrow-not-exempt';
	if (readings.treasuryExempt === false) return 'treasury-not-exempt';
	return 'ok';
}

/** The contract reads the check needs. Kept this narrow so a test can stand in for the chain. */
export interface FeeTokenReader {
	escrow: (_method: typeof ESCROW_FEE_TOKEN_GETTER | 'treasury') => Promise<unknown>;
	token: (_method: 'symbol' | 'isTransferExempt', _params?: readonly [string]) => Promise<unknown>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

class FeeTokenCheckError extends Error {
	constructor(what: string) {
		super(`Fee token check: ${what}.`);
		this.name = 'FeeTokenCheckError';
	}
}

function asAddress(value: unknown, what: string): string {
	if (typeof value !== 'string' || !ADDRESS.test(value)) {
		throw new FeeTokenCheckError(`${what} is not an address`);
	}
	return value;
}

function asBoolean(value: unknown, what: string): boolean {
	if (typeof value !== 'boolean') throw new FeeTokenCheckError(`${what} is not yes or no`);
	return value;
}

/**
 * Reads the chain and returns the verdict. A read that fails, or returns something that is
 * not what the contract declares, throws: no answer is not the same as a wrong token, and
 * the caller must not switch payments off for it.
 */
export async function readFeeTokenVerdict({
	reader,
	configuredToken,
	escrowAddress,
	profile,
}: {
	reader: FeeTokenReader;
	configuredToken: string;
	escrowAddress: string;
	profile: { symbol: string; transferable: boolean };
}): Promise<FeeTokenVerdict> {
	const [rawEscrowToken, rawTreasury] = await Promise.all([
		reader.escrow(ESCROW_FEE_TOKEN_GETTER),
		reader.escrow('treasury'),
	]);
	const escrowToken = asAddress(rawEscrowToken, 'the escrow token');
	const treasury = asAddress(rawTreasury, 'the treasury');

	const base = {
		configuredToken,
		escrowToken,
		expectedSymbol: profile.symbol,
		restricted: !profile.transferable,
	};
	// The remaining reads go to the configured token. If the escrow uses another one they
	// would describe a contract no payment touches.
	if (!sameAddress(escrowToken, configuredToken)) {
		return assessFeeToken({ ...base, onChainSymbol: '' });
	}

	const restricted = !profile.transferable;
	const [rawSymbol, rawEscrowExempt, rawTreasuryExempt] = await Promise.all([
		reader.token('symbol'),
		restricted ? reader.token('isTransferExempt', [escrowAddress]) : undefined,
		restricted ? reader.token('isTransferExempt', [treasury]) : undefined,
	]);
	if (typeof rawSymbol !== 'string') throw new FeeTokenCheckError('the symbol is not text');

	return assessFeeToken({
		...base,
		onChainSymbol: rawSymbol,
		...(restricted
			? {
					escrowExempt: asBoolean(rawEscrowExempt, 'the escrow exemption'),
					treasuryExempt: asBoolean(rawTreasuryExempt, 'the treasury exemption'),
			  }
			: {}),
	});
}

const SETUP_DIFFERS =
	'This version of the app and the SenseAI payment contract are not set up for the same token. Prompts and plan changes are switched off, and nothing has been approved or charged. Reload the page; if this message stays, please contact support.';

/** What the banner says for a verdict that stops payments; null when nothing is wrong. */
export function feeTokenBlockCopy(
	verdict: FeeTokenVerdict,
	symbol: string,
): { title: string; description: string } | null {
	if (verdict === 'ok') return null;
	const title = 'Payments are switched off';
	if (verdict === 'escrow-uses-other-token' || verdict === 'symbol-mismatch') {
		return { title, description: SETUP_DIFFERS };
	}
	return {
		title,
		description: `The SenseAI payment contract cannot move ${symbol} yet, so a payment would fail after you had paid gas for it. Prompts and plan changes are switched off until this is fixed, and nothing has been approved or charged.`,
	};
}
