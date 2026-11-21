/**
 * The one listener for the remote prompts switch, and the store every hook reads it from
 * (`useSyncExternalStore`). However many components ask, one `onSnapshot` is open while any
 * of them is mounted, and it is closed when the last one goes.
 *
 * Reading follows `parseSwitchSnapshot`: only the server's word changes the state. An error,
 * an offline start or a cached answer keeps the last confirmed state; a confirmed closure is
 * saved in this browser so it holds through a reload made offline, and a confirmed open
 * clears it. A listener that cannot read the document is reported (`promptsSwitchReport.ts`)
 * but changes nothing. The collection is named only here (the `prompts-switch-source` guard).
 */
import { doc, type DocumentSnapshot, onSnapshot } from 'firebase/firestore';

import { db } from '@/config/firebase';
import {
	type ClosedState,
	parseSavedSwitch,
	parseSwitchSnapshot,
	type PromptsSwitchState,
	savedSwitchKey,
	serialiseClosed,
	SWITCH_OPEN,
	SWITCH_UNKNOWN,
	switchDocId,
} from '@/lib/promptsSwitch';
import {
	forgetSwitchReports,
	hasReportedListenerFailure,
	reportFault,
	reportListenerFailure,
	reportNoFirestore,
	reportNoServerAnswer,
} from '@/lib/promptsSwitchReport';

const COLLECTION = 'senseai_prompts_switch';

/**
 * How long to wait before listening again after the listener failed. Firestore ends a
 * listener that errors, and without this a passing outage would leave the tab deaf to a
 * closure until it is reloaded.
 */
export const SWITCH_RETRY_MS = 30_000;

/**
 * How long the listener may go without a server answer, while the browser says it is online,
 * before that is reported. A blocked Firestore host looks offline to the SDK, which then
 * answers only from its cache and never calls the error callback.
 */
export const SWITCH_FIRST_ANSWER_MS = 60_000;

let current: PromptsSwitchState | null = null;
const subscribers = new Set<() => void>();
let stopListening: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let answerTimer: ReturnType<typeof setTimeout> | null = null;
let hasServerAnswer = false;

/** The document this build is for, read when needed so a test can set the build's values. */
const configuredDocId = () =>
	switchDocId(import.meta.env.VITE_CHAIN_ID, import.meta.env.VITE_AGENT_CONTRACT_ADDRESS);

// Storage can be refused (a private window, blocked site data): the switch then lives in
// memory only, which still holds for the life of the page.
function loadSaved(docId: string): ClosedState | null {
	try {
		return parseSavedSwitch(localStorage.getItem(savedSwitchKey(docId)));
	} catch {
		return null;
	}
}

function remember(docId: string, state: PromptsSwitchState): void {
	try {
		if (state.status === 'closed')
			localStorage.setItem(savedSwitchKey(docId), serialiseClosed(state));
		else localStorage.removeItem(savedSwitchKey(docId));
	} catch {
		// Kept in memory only; see loadSaved.
	}
}

/**
 * Where a page starts. A build that names no chain or agent has no document to listen to,
 * and nothing is closed there; this matches the fee token check, which reads nothing when
 * no contracts are configured. Otherwise a saved closure, or `unknown` until the server says.
 */
function startingState(): PromptsSwitchState {
	const docId = configuredDocId();
	if (!docId) return SWITCH_OPEN;
	return loadSaved(docId) ?? SWITCH_UNKNOWN;
}

/** The current state, for `useSyncExternalStore`. The same object until it changes. */
export function readPromptsSwitch(): PromptsSwitchState {
	if (current === null) current = startingState();
	return current;
}

function publish(next: PromptsSwitchState): void {
	const now = readPromptsSwitch();
	const isSame =
		now.status === next.status &&
		(now.status !== 'closed' || (next.status === 'closed' && now.wording === next.wording));
	if (isSame) return;
	current = next;
	subscribers.forEach(notify => notify());
}

function onReading(docId: string, snapshot: DocumentSnapshot): void {
	const data: unknown = snapshot.data();
	const reading = parseSwitchSnapshot({
		exists: snapshot.exists(),
		fromCache: snapshot.metadata.fromCache,
		data,
	});
	if (!reading.confirmed) return;
	hasServerAnswer = true;
	if (answerTimer) clearTimeout(answerTimer);
	answerTimer = null;
	// Saved and shown first: a report that fails cannot leave a malformed document open.
	remember(docId, reading.state);
	publish(reading.state);
	if (reading.fault) reportFault(reading.fault, data);
}

function onListenError(code: unknown, relisten: () => void): void {
	// The last state is kept. Only the code is logged and reported: the message can carry
	// project detail.
	stopListening = null;
	console.warn('[prompts switch] listener stopped, keeping the last state:', code);
	reportListenerFailure(code);
	if (subscribers.size > 0 && !retryTimer) {
		retryTimer = setTimeout(() => {
			retryTimer = null;
			if (subscribers.size > 0) relisten();
		}, SWITCH_RETRY_MS);
	}
}

// Once per page load: no server answer in time while online, unless a listener failure
// already explains it.
function awaitFirstAnswer(): void {
	if (hasServerAnswer || answerTimer) return;
	answerTimer = setTimeout(() => {
		answerTimer = null;
		if (!hasServerAnswer && navigator.onLine && !hasReportedListenerFailure()) {
			reportNoServerAnswer();
		}
	}, SWITCH_FIRST_ANSWER_MS);
}

function listen(): void {
	const docId = configuredDocId();
	// No document for this build: nothing to listen to (see startingState).
	if (!docId) return;
	// Firestore did not start: the state stays where it started (a saved closure holds).
	if (!db) {
		reportNoFirestore();
		return;
	}
	// Listening already, or a retry is waiting: a new reader does not cut the wait short.
	if (stopListening || retryTimer) return;
	awaitFirstAnswer();
	stopListening = onSnapshot(
		doc(db, COLLECTION, docId),
		{ includeMetadataChanges: true },
		snapshot => onReading(docId, snapshot),
		error => onListenError(error.code, listen),
	);
}

function stop(): void {
	stopListening?.();
	stopListening = null;
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
	if (answerTimer) clearTimeout(answerTimer);
	answerTimer = null;
}

/** For `useSyncExternalStore`: the first subscriber starts the listener, the last stops it. */
export function subscribePromptsSwitch(notify: () => void): () => void {
	subscribers.add(notify);
	readPromptsSwitch();
	listen();
	return () => {
		subscribers.delete(notify);
		if (subscribers.size === 0) stop();
	};
}

/** Starts afresh, as a page load does: the browser's storage is left as it is. For tests. */
export function resetPromptsSwitchSource(): void {
	stop();
	subscribers.clear();
	current = null;
	hasServerAnswer = false;
	forgetSwitchReports();
}
