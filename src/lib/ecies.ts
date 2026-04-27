import { gcm } from '@noble/ciphers/aes.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

function stripHexPrefix(hex: string): string {
	if (hex.startsWith('0x04')) return hex.slice(2);
	if (hex.startsWith('0x')) return hex.slice(2);
	return hex;
}

function normPubKeyBytes(pubKeyHex: string): Uint8Array {
	const stripped = stripHexPrefix(pubKeyHex);
	const full = stripped.length === 128 ? `04${stripped}` : stripped;
	return new Uint8Array(Buffer.from(full, 'hex'));
}

/**
 * ECIES encrypt using secp256k1 + SHA-256 KDF + AES-256-GCM.
 * Wire format: 0x01 | ephemPubKey(65B) | nonce(12B) | GCM(ciphertext + 16B tag)
 */
export default async function eciesEncrypt(
	recipientPubKeyHex: string,
	plaintext: Uint8Array,
): Promise<Uint8Array> {
	const pubKeyBytes = normPubKeyBytes(recipientPubKeyHex);

	const ephemPrivKey = secp256k1.utils.randomSecretKey();
	const ephemPubKey = secp256k1.getPublicKey(ephemPrivKey, false);

	const sharedSecret = secp256k1.getSharedSecret(ephemPrivKey, pubKeyBytes, false);
	const symmetricKey = sha256(sharedSecret.slice(1, 33));

	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const gcmOutput = gcm(symmetricKey, nonce).encrypt(plaintext);

	const result = new Uint8Array(1 + 65 + 12 + gcmOutput.length);
	result[0] = 0x01;
	result.set(ephemPubKey, 1);
	result.set(nonce, 66);
	result.set(gcmOutput, 78);
	return result;
}
