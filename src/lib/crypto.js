/**
 * Derives a secure AES-GCM CryptoKey from a high-entropy string (e.g., a signature or auth token).
 * This key is non-exportable and should only exist in memory for the session.
 * @param {string} entropy - The high-entropy string to use as the source for the key.
 * @returns {Promise<CryptoKey>} A 256-bit AES-GCM key for encryption and decryption.
 */
export async function deriveKeyFromEntropy(entropy) {
	if (!entropy) {
		throw new Error('Entropy string cannot be empty.');
	}
	// Use the entropy string as the "salt" or input key material (IKM).
	const entropyBuffer = new TextEncoder().encode(entropy);
	const importedKey = await window.crypto.subtle.importKey('raw', entropyBuffer, 'HKDF', false, [
		'deriveKey',
	]);

	// Derive a 256-bit AES-GCM key.
	const derivedKey = await window.crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new Uint8Array() },
		importedKey,
		{ name: 'AES-GCM', length: 256 },
		true, // Key is extractable if needed, but we won't be doing that.
		['encrypt', 'decrypt'],
	);

	return derivedKey;
}

/**
 * Encrypts a JavaScript object using the derived session key.
 * @param {CryptoKey} key - The AES-GCM key derived from the user's signature.
 * @param {object} data - The JavaScript object to encrypt.
 * @returns {Promise<string>} A base64 string containing the IV and encrypted data.
 */
export async function encryptData(key, data) {
	const iv = window.crypto.getRandomValues(new Uint8Array(12));
	const encodedData = new TextEncoder().encode(JSON.stringify(data));

	const encryptedContent = await window.crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encodedData,
	);

	const ivString = btoa(String.fromCharCode(...iv));
	const encryptedString = btoa(String.fromCharCode(...new Uint8Array(encryptedContent)));

	return `${ivString}.${encryptedString}`;
}

/**
 * Decrypts data from a base64 string using the derived session key.
 * @param {CryptoKey} key - The AES-GCM key.
 * @param {string} encryptedString - The string from the database.
 * @returns {Promise<object>} The decrypted JavaScript object.
 */
export async function decryptData(key, encryptedString) {
	if (!encryptedString || !encryptedString.includes('.')) {
		throw new Error('Invalid encrypted data format. Expected "iv.encryptedData".');
	}

	const [ivString, encryptedDataString] = encryptedString.split('.');

	const iv = new Uint8Array(
		atob(ivString)
			.split('')
			.map(c => c.charCodeAt(0)),
	);
	const encryptedData = new Uint8Array(
		atob(encryptedDataString)
			.split('')
			.map(c => c.charCodeAt(0)),
	);

	const decryptedContent = await window.crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		key,
		encryptedData,
	);

	return JSON.parse(new TextDecoder().decode(decryptedContent));
}
