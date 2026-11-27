/**
 * The first click in a freshly created browser context, with one recovery.
 *
 * `renderer-health.ts` asks a new page for one animation frame before the first interaction and
 * reloads once if none comes. The stall it guards against can also begin after that frame: the
 * page then holds the Connect Wallet button, and the click waits its whole timeout for "visible,
 * enabled and stable" on a page that has stopped painting (T-CHAT-10 on the localnet,
 * 2026-11-27, with the probe passing a moment before). A click that timed out did not land, so
 * doing it again is safe.
 *
 * This helper clicks, and when the click times out it says what it saw, reloads the page once,
 * runs the caller's check (a check that throws is reported and does not stop the second click)
 * and clicks again. A second timeout is thrown as it is. Any other error
 * is thrown at once. Like the probe it is a mitigation with a diagnostic, not a cure: every
 * warning it prints is a stall to look at when a run is read.
 */

/** The subset of Page this helper touches. */
export interface ReloadablePage {
	reload: (_options?: { waitUntil?: 'load' }) => Promise<unknown>;
}

/** The subset of Locator this helper touches. */
export interface ClickTarget {
	click: (_options?: { timeout?: number }) => Promise<void>;
	count: () => Promise<number>;
}

export interface FirstClickOptions {
	/** How long each click gets. */
	timeoutMs?: number;
	warn?: (_message: string) => void;
	/** Runs after the reload and before the second click (the renderer probe, in the fixtures). */
	afterReload?: () => Promise<unknown>;
}

const isTimeout = (error: unknown): boolean =>
	error instanceof Error && error.name === 'TimeoutError';

async function presence(target: ClickTarget): Promise<string> {
	try {
		return (await target.count()) > 0 ? 'yes' : 'no';
	} catch {
		return 'unknown';
	}
}

export async function clickPastColdStall(
	page: ReloadablePage,
	target: ClickTarget,
	{ timeoutMs = 15_000, warn = () => {}, afterReload }: FirstClickOptions = {},
): Promise<{ reloaded: boolean }> {
	try {
		await target.click({ timeout: timeoutMs });
		return { reloaded: false };
	} catch (error) {
		if (!isTimeout(error)) throw error;
		warn(
			`first-click: the click did not land within ${timeoutMs} ms ` +
				`(target in the page: ${await presence(target)}) — reloading the page once`,
		);
	}
	await page.reload({ waitUntil: 'load' });
	if (afterReload) {
		try {
			await afterReload();
		} catch (error) {
			// The second click is the last resort and says more than a failed check would.
			warn(
				`first-click: the check after the reload failed ` +
					`(${error instanceof Error ? error.name : typeof error}) — clicking anyway`,
			);
		}
	}
	await target.click({ timeout: timeoutMs });
	return { reloaded: true };
}
