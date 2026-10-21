import * as Sentry from '@sentry/react';

/**
 * Recover from a stale-chunk failure after a deploy (sense-ai-dapp#75).
 *
 * A tab opened on the previous build keeps that build's index.html, whose hashed chunk
 * names vanish from the host (and from the service-worker cache, once the new worker runs
 * cleanupOutdatedCaches) as soon as the next deploy lands. The next lazy route then fails
 * its dynamic import and the React error boundary shows the 418 crash screen.
 *
 * Vite dispatches `vite:preloadError` on `window` for exactly this case. The documented
 * remedy is to reload so the browser fetches the new index.html; the only hazard is a
 * reload loop when a reload does not cure the failure, so each reload is recorded in
 * sessionStorage and a second failure inside the guard window is left to surface through
 * the error boundary (and Sentry) as before.
 */

export const PRELOAD_ERROR_EVENT = 'vite:preloadError';
export const STALE_CHUNK_RELOAD_KEY = 'senseai:stale-chunk-reload-at';
/** Two reloads closer together than this mean the reload did not help: stop and surface. */
export const STALE_CHUNK_RELOAD_WINDOW_MS = 10_000;

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface StaleChunkReloadDeps {
	reload: () => void;
	/** `null` when storage is unavailable; the handler then fails safe (no reload). */
	storage: ReloadStorage | null;
	now: () => number;
	report: (_message: string, _data: Record<string, unknown>) => void;
}

export type PreloadErrorEvent = Event & { payload?: unknown };

const readLastReloadAt = (storage: ReloadStorage | null): number | null => {
	if (!storage) return null;
	const raw = storage.getItem(STALE_CHUNK_RELOAD_KEY);
	if (raw === null) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
};

const describePayload = (payload: unknown): string =>
	payload instanceof Error ? payload.message : String(payload ?? 'unknown');

/**
 * Pure decision + side effects behind injected deps, so the policy is unit-testable.
 * Returns what it did: `'reloaded'` (default prevented, page reloading) or `'suppressed'`
 * (nothing prevented; the import error propagates as it always did).
 */
export function handlePreloadError(
	event: PreloadErrorEvent,
	deps: StaleChunkReloadDeps,
): 'reloaded' | 'suppressed' {
	const reason = describePayload(event.payload);
	const now = deps.now();

	let lastReloadAt: number | null;
	try {
		lastReloadAt = readLastReloadAt(deps.storage);
	} catch {
		// Storage denied (private mode, blocked site data): without a record we cannot bound
		// the loop, so surface the error rather than risk reloading forever.
		deps.report('stale chunk: storage unavailable, not reloading', { reason });
		return 'suppressed';
	}

	if (lastReloadAt !== null && now - lastReloadAt < STALE_CHUNK_RELOAD_WINDOW_MS) {
		deps.report('stale chunk: reload did not help, surfacing error', {
			reason,
			msSinceReload: now - lastReloadAt,
		});
		return 'suppressed';
	}

	try {
		deps.storage?.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
	} catch {
		deps.report('stale chunk: could not record reload, not reloading', { reason });
		return 'suppressed';
	}

	event.preventDefault();
	deps.report('stale chunk: reloading to pick up the new build', { reason });
	deps.reload();
	return 'reloaded';
}

const defaultDeps = (): StaleChunkReloadDeps => ({
	reload: () => window.location.reload(),
	storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
	now: () => Date.now(),
	report: (message, data) =>
		Sentry.addBreadcrumb({ category: 'app.update', level: 'warning', message, data }),
});

/** Install on `window`; call before the first render. Returns the uninstaller. */
export function installStaleChunkReload(deps: StaleChunkReloadDeps = defaultDeps()): () => void {
	const listener = (event: Event) => {
		handlePreloadError(event as PreloadErrorEvent, deps);
	};
	window.addEventListener(PRELOAD_ERROR_EVENT, listener);
	return () => window.removeEventListener(PRELOAD_ERROR_EVENT, listener);
}
