/**
 * Reports a Graph read the sync could not use to Sentry, once per page load for each list and
 * reason. The sync then holds its cursor and tries again on its next pass, so without this a
 * Graph that keeps failing would leave nothing but a console line (Sentry keeps that as a
 * breadcrumb, not an event).
 *
 * It carries the list, the reason and the original error's name only: graphql-request's text
 * holds the endpoint URL, the query and its variables, and the variables hold the wallet
 * address (see GraphFetchFailed). A report never throws: the sync's result is decided already.
 */
import * as Sentry from '@sentry/react';

import type GraphFetchFailed from './GraphFetchFailed';

const reported = new Set<string>();

export function reportGraphFetchFailed(failure: GraphFetchFailed): void {
	const key = `${failure.list}:${failure.reason}`;
	if (reported.has(key)) return;
	reported.add(key);
	try {
		const error = new Error(
			`The history could not be read from The Graph (${failure.list}, ${failure.reason}); the sync cursor is held.`,
		);
		error.name = 'GraphSyncFailure';
		Sentry.captureException(error, {
			tags: { check: 'graph-sync', list: failure.list, reason: failure.reason },
			extra: { errorName: failure.causeName ?? 'none' },
			fingerprint: ['graph-sync-failed', failure.list, failure.reason],
		});
	} catch {
		// Nothing else to do: the cursor is already held and the user already told.
	}
}

/**
 * What was ahead of this device's clock (see syncCursor.ts): a conversation served with a
 * time past the allowance (`time-ahead`), or the stored cursor itself (`stored-cursor-ahead`).
 */
export type GraphTimeAheadKind = 'time-ahead' | 'stored-cursor-ahead';

/**
 * Reports a time ahead of this device's clock once per page load per kind. It carries the
 * kind only: never the time, the conversation or the wallet.
 */
export function reportGraphTimeAhead(kind: GraphTimeAheadKind): void {
	const key = `time:${kind}`;
	if (reported.has(key)) return;
	reported.add(key);
	try {
		const error = new Error(
			kind === 'time-ahead'
				? 'The Graph served a conversation time ahead of this device clock; it was not taken for the sync cursor.'
				: 'The stored sync cursor was ahead of this device clock; the history is read from the start.',
		);
		error.name = 'GraphSyncTimeAhead';
		Sentry.captureException(error, {
			tags: { check: 'graph-sync', list: 'conversations', reason: kind },
			fingerprint: ['graph-sync-time-ahead', kind],
		});
	} catch {
		// Nothing else to do: the cursor is already kept from it.
	}
}

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetGraphSyncReports(): void {
	reported.clear();
}
