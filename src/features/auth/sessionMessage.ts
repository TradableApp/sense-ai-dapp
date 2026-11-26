import { getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

import describeShape from '@/lib/settingShape';

/**
 * The message a wallet signs to create the session key (`deriveSessionKey` in
 * `src/features/auth/sessionKey.ts` turns the signature into the key that encrypts the
 * conversation history).
 *
 * It is an EIP-4361 (Sign-In with Ethereum) message, built and checked by viem's own
 * `createSiweMessage`, so a wallet that reads such messages compares the domain it names
 * with the page asking for the signature and warns when they differ. Its fields:
 * - domain: the host of the site, and URI: the site, one per network by build mode
 *   (`sessionSiteFor`), never the page it is opened on; an `http` site also names its scheme;
 * - address: the signing account, checksummed, so how it is cased changes nothing;
 * - statement: one line saying what the signature creates and never to sign it anywhere but
 *   that site;
 * - Version: `1`, the only value EIP-4361 defines;
 * - Chain ID: the build's;
 * - Nonce and Issued At: constants (`SESSION_NONCE`, which carries `SESSION_MESSAGE_VERSION`,
 *   and `SESSION_ISSUED_AT`). No expiration time, not-before time, request id or resources.
 *
 * The nonce and the time are constants on purpose. The signature is not a login: it is the
 * secret the history key is derived from, so the text must be byte for byte the same on
 * every visit and every device for one wallet, site and chain, or the history already
 * stored cannot be read. What that means: replay protection is not a property of this
 * message. Anyone who obtains the signature once can derive the key for good, and nothing
 * on any server accepts this message as a sign-in.
 *
 * The key is bound to the wallet, the site and the chain, and to nothing else. It names no
 * agent contract: replacing the contract pair on a network changes no user's key, and
 * history from an earlier deployment stays decryptable (which deployment a stored row
 * belongs to is the local store's concern, `src/lib/localStoreName.ts`).
 *
 * Changing any of the text, a site included, changes every user's key, and history stored
 * under the old key can no longer be read: bump `SESSION_MESSAGE_VERSION` when it is done
 * on purpose.
 */

export const SESSION_MESSAGE_VERSION = 3;

/** EIP-4361 nonce: at least 8 letters and digits. Fixed, and changes with the version. */
export const SESSION_NONCE = `SenseAIHistoryKeyV${SESSION_MESSAGE_VERSION}`;

/** EIP-4361 issued-at time. Fixed: the text must be the same on every visit. */
export const SESSION_ISSUED_AT = new Date('2026-11-25T00:00:00.000Z');

const LOCAL_SITE = 'http://localhost:3002';

/**
 * The site named in the message, by build mode. `test` is the mode Vitest runs in.
 *
 * Each value is part of the signed text, so changing one changes the key of every user of
 * that network: do it only with a new `SESSION_MESSAGE_VERSION` and a plan for the history
 * stored under the old key. The testnet value is the host the testnet build is deployed to.
 * `sessionMessage.test.ts` pins all four, so a rename fails there first.
 */
const SESSION_SITES: Readonly<Record<string, string>> = Object.freeze({
	mainnet: 'https://senseai.tradable.app',
	testnet: 'https://sense-ai-app-garrick.web.app',
	localnet: LOCAL_SITE,
	test: LOCAL_SITE,
});

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
	/** The account that signs. */
	walletAddress: string;
}

/** The site (an origin) a build of `mode` names in its message, or undefined for another mode. */
export function sessionSiteFor(mode: string): string | undefined {
	return Object.prototype.hasOwnProperty.call(SESSION_SITES, mode)
		? SESSION_SITES[mode]
		: undefined;
}

const statementFor = (site: string): string =>
	`Sign this only on ${site}. Your signature creates the key that encrypts your SenseAI ` +
	'conversation history, and anyone who has the signature can read that history. Never ' +
	'sign this message on any other site. Signing is free and sends no transaction.';

/** The exact text the wallet is asked to sign. Throws `SessionMessageConfigError`. */
export function buildSessionMessage({ mode, chainId, walletAddress }: SessionMessageInput): string {
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
	if (!ADDRESS.test(walletAddress)) {
		throw new SessionMessageConfigError(
			`The session message needs the wallet address, 0x followed by 40 hex digits; got ${describeShape(
				walletAddress,
			)}.`,
		);
	}
	const { host, protocol } = new URL(site);
	const scheme = protocol.slice(0, -1);

	return createSiweMessage({
		// EIP-4361 takes https when no scheme is named; any other scheme is written out.
		...(scheme === 'https' ? {} : { scheme }),
		domain: host,
		address: getAddress(walletAddress.toLowerCase()),
		statement: statementFor(site),
		uri: site,
		version: '1',
		chainId: Number(chain),
		nonce: SESSION_NONCE,
		issuedAt: SESSION_ISSUED_AT,
	});
}
