import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	handlePreloadError,
	installStaleChunkReload,
	PRELOAD_ERROR_EVENT,
	STALE_CHUNK_RELOAD_KEY,
	STALE_CHUNK_RELOAD_WINDOW_MS,
} from '@/lib/staleChunkReload';

// User journey: as a user with a tab opened on the previous build, when a deploy removes
// the hashed chunk my next lazy route needs, I want the page to refresh itself once so I
// land on the new build instead of the 418 crash screen — and never get stuck in a reload
// loop if the refresh does not cure it.

function makeEvent() {
	const event = new Event(PRELOAD_ERROR_EVENT, { cancelable: true }) as Event & {
		payload?: unknown;
	};
	event.payload = new TypeError('Failed to fetch dynamically imported module');
	return event;
}

function makeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: vi.fn((k: string) => map.get(k) ?? null),
		setItem: vi.fn((k: string, v: string) => {
			map.set(k, v);
		}),
	};
}

function makeDeps(overrides: Partial<Parameters<typeof handlePreloadError>[1]> = {}) {
	return {
		reload: vi.fn(),
		storage: makeStorage(),
		now: () => 1_000_000,
		report: vi.fn(),
		...overrides,
	};
}

describe('handlePreloadError', () => {
	it('reloads once on the first stale-chunk failure and records when it did so', () => {
		const storage = makeStorage();
		const deps = makeDeps({ storage });
		const event = makeEvent();

		const outcome = handlePreloadError(event, deps);

		expect(outcome).toBe('reloaded');
		expect(deps.reload).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
		expect(storage.setItem).toHaveBeenCalledWith(STALE_CHUNK_RELOAD_KEY, '1000000');
		expect(deps.report).toHaveBeenCalledTimes(1);
	});

	it('does not reload again inside the guard window, letting the error surface instead', () => {
		const deps = makeDeps({
			storage: makeStorage({ [STALE_CHUNK_RELOAD_KEY]: String(1_000_000 - 2_000) }),
		});
		const event = makeEvent();

		const outcome = handlePreloadError(event, deps);

		expect(outcome).toBe('suppressed');
		expect(deps.reload).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		expect(deps.report).toHaveBeenCalledTimes(1);
	});

	it('reloads again once the guard window has elapsed', () => {
		const deps = makeDeps({
			storage: makeStorage({
				[STALE_CHUNK_RELOAD_KEY]: String(1_000_000 - STALE_CHUNK_RELOAD_WINDOW_MS - 1),
			}),
		});

		expect(handlePreloadError(makeEvent(), deps)).toBe('reloaded');
		expect(deps.reload).toHaveBeenCalledTimes(1);
	});

	it('fails safe when storage is unavailable: no reload, error surfaces', () => {
		const throwing = {
			getItem: vi.fn(() => {
				throw new DOMException('denied', 'SecurityError');
			}),
			setItem: vi.fn(),
		};
		const deps = makeDeps({ storage: throwing });
		const event = makeEvent();

		expect(handlePreloadError(event, deps)).toBe('suppressed');
		expect(deps.reload).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('treats a corrupt stored timestamp as no prior reload', () => {
		const deps = makeDeps({ storage: makeStorage({ [STALE_CHUNK_RELOAD_KEY]: 'garbage' }) });

		expect(handlePreloadError(makeEvent(), deps)).toBe('reloaded');
	});
});

describe('installStaleChunkReload', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('listens for the Vite preload-error event on window and can be uninstalled', () => {
		const deps = makeDeps();

		const uninstall = installStaleChunkReload(deps);
		window.dispatchEvent(makeEvent());
		expect(deps.reload).toHaveBeenCalledTimes(1);

		uninstall();
		window.dispatchEvent(makeEvent());
		expect(deps.reload).toHaveBeenCalledTimes(1);
	});
});
