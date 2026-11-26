/**
 * Reports a session key problem to Sentry once per page load for each kind: the local store
 * was written under another key (`mismatch`), or the wallet's signature could not become a key
 * (`unsupported-signature`, with why: `not-plain-ecdsa` or `other-signer`).
 *
 * A report carries the kind only: never the address, the signature, the message or the key.
 * It never throws; the user has been told already.
 */
import * as Sentry from '@sentry/react';

import type { SessionSignatureRefusal } from '@/features/auth/sessionKey';

const reported = new Set<string>();

function report(key: string, message: string, tags: Record<string, string>, fingerprint: string[]) {
	if (reported.has(key)) return;
	reported.add(key);
	try {
		const error = new Error(message);
		error.name = 'SessionKeyCheck';
		Sentry.captureException(error, { tags: { check: 'session-key', ...tags }, fingerprint });
	} catch {
		// Nothing else to do: the notice is already shown.
	}
}

export function reportSessionKeyMismatch(): void {
	report(
		'mismatch',
		'The local store was written under another session key; its history cannot be opened.',
		{ kind: 'mismatch' },
		['session-key', 'mismatch'],
	);
}

export function reportUnsupportedSignature(kind: SessionSignatureRefusal): void {
	report(
		`unsupported-signature:${kind}`,
		`The wallet's signature cannot become a session key (${kind}).`,
		{ kind: 'unsupported-signature', signature: kind },
		['session-key', 'unsupported-signature', kind],
	);
}

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetSessionKeyReports(): void {
	reported.clear();
}
