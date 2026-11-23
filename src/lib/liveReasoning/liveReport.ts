/**
 * What the live reasoning overlay reports to Sentry: a difference between what was shown live
 * and what was stored (once per answer, by kind), and a refusal that means the stream can never
 * work for this answer (once per page load, by kind). A report carries kinds only: never an
 * answer id, a proof, a URL or any text from a frame or an answer. A report never throws.
 */
import * as Sentry from '@sentry/react';

import { isReplica } from '@/lib/liveReasoning/contract';

export type MismatchKind =
	| 'step-count'
	| 'step-text'
	| 'source-count'
	| 'source-text'
	| 'answer-attempt'
	| 'answer-text';
export type RefusalKind = 'bad-request' | 'proof-refused';

const reported = new Set<string>();

function send(key: string, error: Error, tags: Record<string, string>, fingerprint: string[]) {
	if (reported.has(key)) return;
	reported.add(key);
	try {
		Sentry.captureException(error, {
			tags: { check: 'live-reasoning', ...tags },
			fingerprint: ['live-reasoning', ...fingerprint],
		});
	} catch {
		// Nothing else to do: what is shown does not depend on the report.
	}
}

function named(name: string, message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

/**
 * A difference between the live view and the stored answer. The answer id keys the once-only
 * rule in memory and is not sent. The replica id names an oracle process, never a user.
 */
export function reportMismatch(
	answerMessageId: string,
	mismatch: MismatchKind,
	replica: string | null,
): void {
	send(
		`mismatch:${answerMessageId}`,
		named(
			'LiveReasoningMismatch',
			`What was shown live differs from the stored answer: ${mismatch}.`,
		),
		{ mismatch, ...(isReplica(replica) ? { replica } : {}) },
		[mismatch],
	);
}

/** The stream refused this build's request (a malformed request, or a proof it did not accept). */
export function reportRefusal(refusal: RefusalKind): void {
	send(
		`refusal:${refusal}`,
		named('LiveReasoningRefused', `The reasoning stream refused the request: ${refusal}.`),
		{ refusal },
		['refusal', refusal],
	);
}

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetLiveReports(): void {
	reported.clear();
}
