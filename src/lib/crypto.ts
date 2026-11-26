const DEFAULT_KEY_CONTEXT = 'SenseAI dApp v1 AES-GCM Key';

/**
 * Derives a secure AES-GCM CryptoKey from a high-entropy string
 * using the user's address as a salt for domain separation.
 * This key should only exist in memory for the session.
 * The key is extractable (needed for roflEncryptedKey generation in contract calls).
 * @param {string} entropy - The high-entropy string (e.g., a signature or auth token).
 * @param {string} ownerAddress - The user's wallet address, used to generate a deterministic salt.
 * @param {string} context - HKDF's info: what the key is for. The session key passes one that
 *   names the session message version (`sessionKeyInfo`); the default is the original string.
 * @returns {Promise<CryptoKey>} A 256-bit AES-GCM key for encryption and decryption.
 */
export async function deriveKeyFromEntropy(
	entropy: string,
	ownerAddress: string,
	context: string = DEFAULT_KEY_CONTEXT,
) {
	if (!entropy) {
		throw new Error('Entropy string cannot be empty.');
	}
	if (!ownerAddress) {
		throw new Error('Owner address must be provided to generate a key salt.');
	}

	// Use the entropy string as the input key material (IKM).
	const entropyBuffer = new TextEncoder().encode(entropy);
	const importedKey = await window.crypto.subtle.importKey('raw', entropyBuffer, 'HKDF', false, [
		'deriveKey',
	]);

	// --- ENHANCEMENT: Use a deterministic salt and application-specific info ---
	// The salt ensures keys are unique per user, even if two users had the same password (not applicable here, but good practice).
	// The info provides "domain separation," ensuring this key is only for this specific application purpose.
	const salt = new TextEncoder().encode(ownerAddress);
	const info = new TextEncoder().encode(context);

	const derivedKey = await window.crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		importedKey,
		{ name: 'AES-GCM', length: 256 },
		true, // Extractable so that roflEncryptedKey can be generated
		['encrypt', 'decrypt'],
	);

	return derivedKey;
}

/**
 * Bytes handed to one `String.fromCharCode` call. Spreading a whole ciphertext into one call
 * passes one argument per byte and overflows the stack once it is a few hundred kilobytes (a
 * conversation of about a thousand messages), so the bytes are converted in slices this size.
 */
const CHAR_CODE_SLICE = 0x8000;

/** Base64 of `bytes`, the same text `btoa(String.fromCharCode(...bytes))` gives, at any size. */
function bytesToBase64(bytes: Uint8Array): string {
	const slices = Array.from({ length: Math.ceil(bytes.length / CHAR_CODE_SLICE) }, (_, i) =>
		String.fromCharCode(...bytes.subarray(i * CHAR_CODE_SLICE, (i + 1) * CHAR_CODE_SLICE)),
	);
	return btoa(slices.join(''));
}

/**
 * Encrypts a JavaScript object using the derived session key.
 * @param {CryptoKey} key - The AES-GCM key derived from the user's signature.
 * @param {object} data - The JavaScript object to encrypt.
 * @returns {Promise<string>} A base64 string containing the IV and encrypted data.
 */
export async function encryptData(key: CryptoKey, data: unknown) {
	const iv = window.crypto.getRandomValues(new Uint8Array(12));
	const encodedData = new TextEncoder().encode(JSON.stringify(data));

	const encryptedContent = await window.crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encodedData,
	);

	const ivString = bytesToBase64(iv);
	const encryptedString = bytesToBase64(new Uint8Array(encryptedContent));

	return `${ivString}.${encryptedString}`;
}

/** The text is not sealed data: no "iv.encryptedData" form, or a part that is not base64. */
export class EncryptedDataFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EncryptedDataFormatError';
	}
}

const base64ToBytes = (text: string): Uint8Array => {
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		throw new EncryptedDataFormatError('Invalid encrypted data format. A part is not base64.');
	}
	return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
};

/**
 * Decrypts a base64 "iv.encryptedData" string to its plaintext bytes, unparsed, so a reader can
 * check their size before it parses them (the live reasoning frames).
 * @param {CryptoKey} key - The AES-GCM key.
 * @param {string} encryptedString - The sealed string.
 * @returns {Promise<Uint8Array>} The plaintext bytes.
 */
export async function decryptBytes(key: CryptoKey, encryptedString: string) {
	if (!encryptedString || !encryptedString.includes('.')) {
		throw new EncryptedDataFormatError(
			'Invalid encrypted data format. Expected "iv.encryptedData".',
		);
	}

	const [ivString, encryptedDataString] = encryptedString.split('.');

	const iv = base64ToBytes(ivString);
	const encryptedData = base64ToBytes(encryptedDataString);

	const decryptedContent = await window.crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		key,
		encryptedData,
	);

	return new Uint8Array(decryptedContent);
}

/**
 * Whether `error` is a failure to decrypt: Web Crypto's `OperationError` (sealed under another
 * key, or the ciphertext was changed) or `EncryptedDataFormatError` (not sealed data). Stored
 * data that fails this way cannot be read with this key; any other error is a fault.
 * Compared by name, since Web Crypto's `DOMException` may come from another realm.
 */
export function isUndecryptable(error: unknown): boolean {
	if (error instanceof EncryptedDataFormatError) return true;
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { name?: unknown }).name === 'OperationError'
	);
}

/**
 * Decrypts data from a base64 string using the derived session key.
 * @param {CryptoKey} key - The AES-GCM key.
 * @param {string} encryptedString - The string from the database.
 * @returns {Promise<object>} The decrypted JavaScript object.
 */
export async function decryptData(key: CryptoKey, encryptedString: string) {
	return JSON.parse(new TextDecoder().decode(await decryptBytes(key, encryptedString)));
}

/**
 * Decrypts like `decryptData`, but gives null when the data cannot be decrypted with this key
 * (`isUndecryptable`), for stored rows that may have been written under another session key.
 * Any other error is thrown as it is.
 */
export async function decryptDataOrNull<T = unknown>(
	key: CryptoKey,
	encryptedString: string,
): Promise<T | null> {
	try {
		return (await decryptData(key, encryptedString)) as T;
	} catch (error) {
		if (isUndecryptable(error)) return null;
		throw error;
	}
}
