/**
 * What the prompts switch reports to Sentry, each kind once per page load: a document it
 * cannot read as the switch (by its shape only), a listener that fails (by its Firestore
 * code only: the message can carry project detail), Firestore not starting, and no server
 * answer within a minute while the browser says it is online (a blocked Firestore host looks
 * offline to the SDK, so its error callback never fires). A report never throws: the
 * switch's state is decided before it is made, and a failed report must not change it.
 */
import * as Sentry from '@sentry/react';

import { describeSwitchDocument, type SwitchFault } from '@/lib/promptsSwitch';

const reported = new Set<string>();

const FIRESTORE_CODE = /^[a-z][a-z-]{0,39}$/;

function send(key: string, error: Error, tags: Record<string, string>, fingerprint: string[]) {
	if (reported.has(key)) return;
	reported.add(key);
	try {
		Sentry.captureException(error, {
			tags: { check: 'prompts-switch', chainId: String(import.meta.env.VITE_CHAIN_ID), ...tags },
			fingerprint: ['prompts-switch', ...fingerprint],
		});
	} catch {
		// Nothing else to do: the state is already published and saved.
	}
}

function named(name: string, message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

export function reportFault(fault: SwitchFault, data: unknown): void {
	send(
		`fault:${fault}`,
		named(
			'PromptsSwitchFault',
			`The prompts switch document is ${fault}: ${describeSwitchDocument(data)}.`,
		),
		{ fault },
		[fault],
	);
}

/** The Firestore error code only; anything that does not look like one is `other`. */
export function reportListenerFailure(code: unknown): void {
	const safeCode = typeof code === 'string' && FIRESTORE_CODE.test(code) ? code : 'other';
	send(
		`listener:${safeCode}`,
		named('PromptsSwitchListenerFailure', `The prompts switch listener failed: ${safeCode}.`),
		{ failure: `listener-${safeCode}` },
		['listener', safeCode],
	);
}

export function reportNoFirestore(): void {
	send(
		'no-firestore',
		named(
			'PromptsSwitchListenerFailure',
			'Firestore did not start; the prompts switch is not read.',
		),
		{ failure: 'no-firestore' },
		['no-firestore'],
	);
}

export function reportNoServerAnswer(): void {
	send(
		'no-server-answer',
		named(
			'PromptsSwitchListenerFailure',
			'No server answer for the prompts switch while the browser is online.',
		),
		{ failure: 'no-server-answer' },
		['no-server-answer'],
	);
}

/** Whether a listener failure has been reported, which explains a missing answer already. */
export const hasReportedListenerFailure = (): boolean =>
	[...reported].some(key => key.startsWith('listener:'));

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetSwitchReports(): void {
	reported.clear();
}
