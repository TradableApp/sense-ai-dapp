import { isAnswerMessageId } from '@/lib/liveReasoning/contract';
import sessionKeyHmac from '@/lib/sessionKeyHmac';

const PROOF_DOMAIN = 'senseai-stream:';

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
	return sessionKeyHmac(sessionKey, PROOF_DOMAIN + answerMessageId);
}
