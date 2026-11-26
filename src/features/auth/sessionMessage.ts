import { getAddress } from 'viem';

import describeShape from '@/lib/settingShape';

/**
 * The message a wallet signs to create the session key (`deriveKeyFromEntropy` in
 * `src/lib/crypto.ts` turns the signature into the key that encrypts the conversation
 * history).
 *
 * What it guarantees:
 * - It names, in words read in the wallet's prompt, the one site it belongs to, the chain,
 *   the agent contract whose history the key opens and the signing account, and says never
 *   to sign it anywhere else. A page on any other host asking for this text shows a host
 *   that is not the one named.
 * - It is the same text on every visit and every device for one wallet, site, chain and
 *   agent (no time, no nonce), so the key can be derived again and the stored history read.
 *   Addresses are written in their checksummed form, so how a setting is cased changes
 *   nothing.
 * - The key differs per network and per agent contract, as the local store does.
 * - It carries a version, so a later change to the text is deliberate: changing any of it
 *   changes every user's key, and history stored under the old key can no longer be read.
 *
 * The site is per network, not per host: every host that serves one network's build (a
 * custom domain and the hosting provider's default domains) asks for the same text, so a
 * user reaches the same history from each of them. It comes from the build's mode, never
 * from the page it is opened on.
 *
 * The form follows the opening lines of EIP-4361 (Sign-In with Ethereum), but it is not a
 * sign-in message: it has none of the fields that vary per request.
 */

export const SESSION_MESSAGE_VERSION = 2;

const LOCAL_SITE = 'http://localhost:3002';

/** The site named in the message, by build mode. `test` is the mode Vitest runs in. */
const SESSION_SITES: Readonly<Record<string, string>> = Object.freeze({
	mainnet: 'https://senseai.tradable.app',
	testnet: 'https://sense-ai-app-garrick.web.app',
	localnet: LOCAL_SITE,
	test: LOCAL_SITE,
});

/** Modes that may build the message with no agent contract configured. */
const MAY_RUN_WITHOUT_AGENT = new Set(['localnet', 'test']);
const NO_AGENT = 'none (a local build with no agent)';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_ID = /^[1-9][0-9]*$/;

/** The message cannot be built: the mode has no site, or a setting is missing or malformed. */
export class SessionMessageConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SessionMessageConfigError';
	}
}

export interface SessionMessageInput {
	/** The build's mode (`import.meta.env.MODE`). */
	mode: string;
	/** The build's chain id (`VITE_CHAIN_ID`). */
	chainId: string | number | undefined;
	/** The build's agent contract (`VITE_AGENT_CONTRACT_ADDRESS`). */
	agentAddress: string | undefined;
	/** The account that signs. */
	walletAddress: string;
}

/** The site (an origin) a build of `mode` names in its message, or undefined for another mode. */
export function sessionSiteFor(mode: string): string | undefined {
	return Object.prototype.hasOwnProperty.call(SESSION_SITES, mode)
		? SESSION_SITES[mode]
		: undefined;
}

const checksummed = (address: string): string => getAddress(address.toLowerCase());

function agentLine(mode: string, agentAddress: string | undefined): string {
	if (!agentAddress && MAY_RUN_WITHOUT_AGENT.has(mode)) return NO_AGENT;
	if (!agentAddress || !ADDRESS.test(agentAddress)) {
		throw new SessionMessageConfigError(
			`The session message needs the agent contract address, 0x followed by 40 hex digits; got ${describeShape(
				agentAddress ?? '',
			)}.`,
		);
	}
	return checksummed(agentAddress);
}

/** The exact text the wallet is asked to sign. Throws `SessionMessageConfigError`. */
export function buildSessionMessage({
	mode,
	chainId,
	agentAddress,
	walletAddress,
}: SessionMessageInput): string {
	const site = sessionSiteFor(mode);
	if (!site) {
		throw new SessionMessageConfigError(
			'The session message names no site for this build mode; add the mode to SESSION_SITES.',
		);
	}
	const chain = String(chainId ?? '');
	if (!CHAIN_ID.test(chain)) {
		throw new SessionMessageConfigError(
			`The session message needs a chain id, a whole number above 0; got ${describeShape(chain)}.`,
		);
	}
	const agent = agentLine(mode, agentAddress);
	if (!ADDRESS.test(walletAddress)) {
		throw new SessionMessageConfigError(
			`The session message needs the wallet address, 0x followed by 40 hex digits; got ${describeShape(
				walletAddress,
			)}.`,
		);
	}
	const { host } = new URL(site);

	return [
		`${host} asks you to sign this message with your account:`,
		checksummed(walletAddress),
		'',
		`Sign this only on ${site}. Your signature creates the key that encrypts your SenseAI ` +
			'conversation history, and anyone who has the signature can read that history. Never ' +
			'sign this message on any other site, or for anyone who asks you to.',
		'',
		'Signing is free, sends no transaction and gives no permission to move your funds.',
		'',
		'Purpose: SenseAI conversation history encryption key',
		`Site: ${site}`,
		`Chain ID: ${chain}`,
		`Agent contract: ${agent}`,
		`Message version: ${SESSION_MESSAGE_VERSION}`,
	].join('\n');
}
