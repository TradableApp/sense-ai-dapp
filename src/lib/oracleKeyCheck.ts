/**
 * Whether the oracle key this build encrypts to is the one the agent contract publishes.
 *
 * Every paid action that sends a prompt or a conversation's metadata wraps the session key
 * for the oracle with the build setting `VITE_ORACLE_PUBLIC_KEY`. The oracle publishes its
 * own key on the agent contract (`oracleEncryptionKey()`), and only an address with the
 * oracle role, proving it holds the key, can set it. A build whose key differs would send
 * prompts the oracle cannot read: they are paid for and never answered. So the chain is
 * read and compared, and those actions are switched off while the two differ, or while the
 * chain holds no key at all.
 *
 * Neither key is ever shown, logged or reported: only the verdict leaves this module.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { LOCAL_CHAIN_ID } from '@/config/contracts';
import type { PaidAction } from '@/lib/feeTokenCheck';

/** Every answer the check can give. `mismatch` and `no-key` have banner words. */
export const ORACLE_KEY_VERDICTS = ['match', 'mismatch', 'no-key', 'no-key-localnet'] as const;
export type OracleKeyVerdict = (typeof ORACLE_KEY_VERDICTS)[number];

/** `unknown`: the check has not answered, or could not. Nothing is stopped for it. */
export type OracleKeyCheckState = OracleKeyVerdict | 'unknown';

/** The agent's getter for the key clients encrypt to. Empty bytes while none is published. */
export const AGENT_ORACLE_KEY_GETTER = 'oracleEncryptionKey';

const HEX = /^0x[0-9a-fA-F]*$/;
const NO_KEY = '0x';

/**
 * A secp256k1 public key in one form: uncompressed, lower-case hex, no `0x`. Accepts what the
 * encryption accepts (`src/lib/ecies.ts`): hex with or without `0x`, in any case, compressed
 * (33 bytes), uncompressed (65 bytes) or uncompressed without its leading `04` (64 bytes).
 * Null for anything that is not a point on the curve.
 */
export function normaliseOracleKey(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const bare = value.trim().replace(/^0x/i, '');
	if (!/^[0-9a-fA-F]+$/.test(bare)) return null;
	const full = bare.length === 128 ? `04${bare}` : bare;
	if (full.length !== 66 && full.length !== 130) return null;
	try {
		return secp256k1.Point.fromHex(full.toLowerCase()).toHex(false);
	} catch {
		return null;
	}
}

function unreadable(what: string): Error {
	const error = new Error(`Oracle key check: ${what}.`);
	error.name = 'OracleKeyCheckError';
	return error;
}

/**
 * Whether a chain with no published key stops anything. The localnet oracle does not
 * publish its key (it uses the environment key there, and nothing sets one on chain), so on
 * localnet an empty slot stops nothing; a key that is published there and differs still
 * does. Every other chain fails closed.
 */
export const noKeyStops = (chainId: number) => chainId !== LOCAL_CHAIN_ID;

interface VerdictInput {
	/** Reads `oracleEncryptionKey()` from the agent contract. */
	read: () => Promise<unknown>;
	/** The key this build encrypts to (`VITE_ORACLE_PUBLIC_KEY`). */
	buildKey: unknown;
	chainId: number;
}

/**
 * Reads the chain and returns the verdict. A read that fails, or returns anything but hex,
 * throws: no answer is not a wrong key, and the caller must not switch anything off for it.
 * A published value that is not a point, or a build key that is missing or not a point, can
 * never be the key the oracle reads with, so either is a `mismatch`.
 */
export async function readOracleKeyVerdict({
	read,
	buildKey,
	chainId,
}: VerdictInput): Promise<OracleKeyVerdict> {
	const onChain = await read();
	if (typeof onChain !== 'string' || !HEX.test(onChain)) {
		throw unreadable('the published key is not hex');
	}
	if (onChain === NO_KEY) return noKeyStops(chainId) ? 'no-key' : 'no-key-localnet';
	const published = normaliseOracleKey(onChain);
	const built = normaliseOracleKey(buildKey);
	return published !== null && published === built ? 'match' : 'mismatch';
}

/**
 * The actions that wrap the session key for the oracle: a prompt (and a regenerate or a
 * resent edit), a branch, and a rename or delete. A plan wraps nothing and is not here.
 */
export const KEY_WRAPPING_ACTIONS: readonly PaidAction[] = ['prompt', 'branch', 'metadata'];

/** Whether an action is switched off under a state. */
export function oracleKeyBlocks(state: OracleKeyCheckState, action: PaidAction): boolean {
	if (state !== 'mismatch' && state !== 'no-key') return false;
	return KEY_WRAPPING_ACTIONS.includes(action);
}

const WHAT_IS_OFF =
	'Prompts, branches, renames and deletes are switched off while this message shows, and nothing is taken for an action that is switched off. Setting or revoking a plan still works.';
const MONEY_BACK_WORKS = 'Cancelling a prompt and claiming a refund still work.';
// Beside a fee token notice, which may say a refund would be refused too.
const MONEY_BACK_UNAFFECTED = 'This does not affect cancelling a prompt or claiming a refund.';
const GET_HELP =
	'If this message stays after you reload the page, tell us through Support in the menu. We will never ask for your recovery phrase.';

/**
 * What the user is told for a state that stops something; null when nothing is stopped.
 * `otherProblem` is true when a fee token notice is shown beside it.
 */
export function oracleKeyBlockCopy(
	state: OracleKeyCheckState,
	{ otherProblem = false }: { otherProblem?: boolean } = {},
): { title: string; description: string } | null {
	const moneyBack = otherProblem ? MONEY_BACK_UNAFFECTED : MONEY_BACK_WORKS;
	switch (state) {
		case 'match':
		case 'no-key-localnet':
		case 'unknown':
			return null;
		case 'mismatch':
			return {
				title: 'Prompts are switched off',
				description: `This version of the app is set up with a different encryption key from the one the SenseAI oracle publishes, so the oracle could not read a prompt sent from it and would not answer. ${WHAT_IS_OFF} ${moneyBack} Reloading the page may load a version with the right key. ${GET_HELP}`,
			};
		case 'no-key':
			return {
				title: 'Prompts are switched off',
				description: `The SenseAI oracle has not published its encryption key yet, so no prompt can be sent that it could read. ${WHAT_IS_OFF} ${moneyBack} This message goes away once a later check finds the key. ${GET_HELP}`,
			};
		default: {
			// A state with no words here fails to compile: a block must never be silent.
			const unhandled: never = state;
			return unhandled;
		}
	}
}
