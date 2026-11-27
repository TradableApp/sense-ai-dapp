const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

/**
 * base64url(HMAC-SHA256(raw session key, message)), no padding: 43 characters. Only the holder of
 * the session key (and the oracle, which receives it) can compute it. Each use puts its own label
 * at the start of the message, so values made for different purposes are never equal.
 */
export default async function sessionKeyHmac(
	sessionKey: CryptoKey,
	message: string,
): Promise<string> {
	const raw = await window.crypto.subtle.exportKey('raw', sessionKey);
	const hmacKey = await window.crypto.subtle.importKey(
		'raw',
		raw,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await window.crypto.subtle.sign(
		'HMAC',
		hmacKey,
		new TextEncoder().encode(message),
	);
	return toBase64Url(new Uint8Array(signature));
}
