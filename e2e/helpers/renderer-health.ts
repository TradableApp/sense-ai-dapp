/**
 * Renderer health check for a freshly created browser context.
 *
 * Once per Base Sepolia run (T-HIST-10 on 2026-11-09, T-PLAN-01 on 2026-11-10) a new context's
 * page stopped scheduling animation frames while its JavaScript kept running: Playwright found the
 * Connect Wallet button and then waited the full 15 s for "visible, enabled and stable", a check
 * that needs requestAnimationFrame to fire. The trace shows zero frames in that window and console
 * output inside it, so the main thread was alive and the renderer was not painting. The retry in a
 * new context passed every time.
 *
 * This helper asks the page for one animation frame before the first interaction. If none arrives
 * inside the deadline — or `page.evaluate` itself never returns — it reloads the page once and asks
 * again, and returns what it saw so the fixture can log it. It is a mitigation with a diagnostic,
 * not a cure: the cause is the headless renderer under host load, which the testnet project also
 * addresses with `--disable-gpu`.
 */

export interface RendererProbe {
	ok: boolean;
	visibility: string;
	waitedMs: number;
}

export interface RendererHealth extends RendererProbe {
	reloaded: boolean;
}

/** The subset of Page this helper touches — a fake stands in for it in the unit tests. */
export interface ProbeablePage {
	evaluate: (_fn: (_arg: number) => Promise<RendererProbe>, _arg: number) => Promise<RendererProbe>;
	reload: (_options?: { waitUntil?: 'load' }) => Promise<unknown>;
}

export interface EnsureOptions {
	/** How long the page gets to deliver one frame. */
	timeoutMs?: number;
	/** Extra time for `evaluate` itself before a silent page counts as frozen. */
	graceMs?: number;
	warn?: (_message: string) => void;
}

/* eslint-env browser */
/** Runs IN the page: resolves on the first animation frame, or on the deadline with ok=false. */
const probeFrame = (timeoutMs: number): Promise<RendererProbe> =>
	new Promise<RendererProbe>(resolve => {
		const start = performance.now();
		const timer = setTimeout(
			() =>
				resolve({
					ok: false,
					visibility: document.visibilityState,
					waitedMs: Math.round(performance.now() - start),
				}),
			timeoutMs,
		);
		requestAnimationFrame(() => {
			clearTimeout(timer);
			resolve({
				ok: true,
				visibility: document.visibilityState,
				waitedMs: Math.round(performance.now() - start),
			});
		});
	});

async function probe(
	page: ProbeablePage,
	timeoutMs: number,
	graceMs: number,
): Promise<RendererProbe> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const frozen = new Promise<RendererProbe>(resolve => {
		timer = setTimeout(
			() =>
				resolve({
					ok: false,
					visibility: 'unknown (evaluate hung)',
					waitedMs: timeoutMs + graceMs,
				}),
			timeoutMs + graceMs,
		);
	});
	try {
		return await Promise.race([page.evaluate(probeFrame, timeoutMs), frozen]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function ensureRendererAlive(
	page: ProbeablePage,
	{ timeoutMs = 2_000, graceMs = 1_000, warn = () => {} }: EnsureOptions = {},
): Promise<RendererHealth> {
	const first = await probe(page, timeoutMs, graceMs);
	if (first.ok) return { ...first, reloaded: false };

	warn(
		`renderer-health: no animation frame within ${first.waitedMs} ms ` +
			`(visibilityState ${first.visibility}) — reloading the page once`,
	);
	await page.reload({ waitUntil: 'load' });
	const second = await probe(page, timeoutMs, graceMs);
	if (!second.ok) {
		warn(
			`renderer-health: still no animation frame after reload (${second.waitedMs} ms, ` +
				`visibilityState ${second.visibility}) — the first interaction will likely stall`,
		);
	}
	return { ...second, reloaded: true };
}
