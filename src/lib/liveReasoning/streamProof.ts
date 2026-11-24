import { isAnswerMessageId } from '@/lib/liveReasoning/contract';

const PROOF_DOMAIN = 'senseai-stream:';

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

/**
 * Proof of key for one answer's stream: base64url(HMAC-SHA256(session key, "senseai-stream:" +
 * answerMessageId)), no padding. Only the user and the oracle can compute it, and the stream
 * server compares it without ever holding the key. It travels in a request header only: never
 * in a URL, a log line or a report.
 */
export default async function streamProof(
	sessionKey: CryptoKey,
	answerMessageId: string,
): Promise<string> {
	if (!isAnswerMessageId(answerMessageId)) {
		throw new TypeError('The answer id must be a canonical decimal string.');
	}
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
		new TextEncoder().encode(PROOF_DOMAIN + answerMessageId),
	);
	return toBase64Url(new Uint8Array(signature));
}
