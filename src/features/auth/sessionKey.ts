import {
	getAddress,
	type Hex,
	isAddressEqual,
	parseSignature,
	recoverMessageAddress,
	serializeSignature,
} from 'viem';

import { SESSION_MESSAGE_VERSION } from '@/features/auth/sessionMessage';
import { deriveKeyFromEntropy } from '@/lib/crypto';

/**
 * Turns the wallet's signature of the session message into the session key.
 *
 * Everything that feeds the key is brought to one form first, so one wallet signing one text
 * always gets one key:
 * - the signature: lower-case hex, 65 bytes, the low of its two valid `s` values, and `v` as
 *   27 or 28, which is the form viem's `serializeSignature` writes (and the form `personal_sign`
 *   gives on the common wallets). Upper-case hex, `v` as 0 or 1 and the high-`s` twin of one
 *   signature are all the same signature, and all give this one form;
 * - the salt: the account checksummed, as the message writes it;
 * - HKDF's info: names the session message version (`sessionKeyInfo`).
 *
 * Only a plain ECDSA signature that recovers to the connected account becomes a key. A smart
 * account's signature (ERC-1271, or ERC-6492 wrapped before the account is deployed; a
 * passkey's WebAuthn signature) is longer than 65 bytes, and may change from one signing to the
 * next or once the account is deployed, so it cannot give the same key twice. A 65-byte
 * signature that recovers to another address (a contract wallet signing with an owner key, or
 * another account) is refused too. Both throw `SessionSignatureError`.
 */

/** Why a signature cannot become the session key. */
export type SessionSignatureRefusal = 'not-plain-ecdsa' | 'other-signer';

export class SessionSignatureError extends Error {
	readonly kind: SessionSignatureRefusal;

	constructor(kind: SessionSignatureRefusal) {
		super(
			kind === 'not-plain-ecdsa'
				? 'The wallet did not sign with a plain account key, so no session key can be made from it.'
				: 'The signature is not from the connected account, so no session key can be made from it.',
		);
		this.name = 'SessionSignatureError';
		this.kind = kind;
	}
}

// The order of secp256k1's group. A signature's two valid `s` values are s and n - s.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = SECP256K1_N / 2n;
const PLAIN_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** HKDF's info for the session key: names the version of the message that was signed. */
export const sessionKeyInfo = (version: number): string =>
	`SenseAI session key v${version} AES-GCM`;

/** The one form of a plain ECDSA signature. Throws `SessionSignatureError` for anything else. */
export function canonicalSignature(signature: string): Hex {
	if (!PLAIN_SIGNATURE.test(signature)) throw new SessionSignatureError('not-plain-ecdsa');
	let parsed: ReturnType<typeof parseSignature>;
	try {
		parsed = parseSignature(signature.toLowerCase() as Hex);
	} catch {
		// An r or s of 0 or not below n, or a v other than 0, 1, 27 or 28.
		throw new SessionSignatureError('not-plain-ecdsa');
	}
	const s = BigInt(parsed.s);
	const isHighS = s > HALF_N;
	return serializeSignature({
		r: parsed.r,
		s: isHighS ? (`0x${(SECP256K1_N - s).toString(16).padStart(64, '0')}` as Hex) : parsed.s,
		// The other valid signature for the same r: s becomes n - s and the parity flips.
		yParity: (isHighS ? 1 - parsed.yParity : parsed.yParity) as 0 | 1,
	});
}

interface DeriveSessionKeyInput {
	/** The exact text that was signed (`buildSessionMessage`). */
	message: string;
	/** What the wallet returned. */
	signature: string;
	/** The connected account. */
	walletAddress: string;
}

/** The session key, or `SessionSignatureError` when the signature cannot give a stable one. */
export async function deriveSessionKey({
	message,
	signature,
	walletAddress,
}: DeriveSessionKeyInput): Promise<CryptoKey> {
	const canonical = canonicalSignature(signature);
	const account = getAddress(walletAddress.toLowerCase());
	const signer = await recoverMessageAddress({ message, signature: canonical }).catch(() => {
		// An r that is no point's x coordinate recovers to nothing.
		throw new SessionSignatureError('not-plain-ecdsa');
	});
	if (!isAddressEqual(signer, account)) throw new SessionSignatureError('other-signer');
	return deriveKeyFromEntropy(canonical, account, sessionKeyInfo(SESSION_MESSAGE_VERSION));
}
