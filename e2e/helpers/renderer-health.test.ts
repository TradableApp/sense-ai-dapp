// @vitest-environment node
//
// Once per Base Sepolia run a fresh browser context stopped painting: Playwright found the
// Connect Wallet button, then waited 15 s for "visible, enabled and stable" while the page's JS
// kept logging (T-HIST-10 on 2026-11-09, T-PLAN-01 on 2026-11-10). The actionability check needs
// requestAnimationFrame; when the renderer does not schedule frames it never resolves. This
// helper asks for one frame before the first interaction and reloads the page once if none comes.
import { describe, expect, it, vi } from 'vitest';

import { ensureRendererAlive, type RendererProbe } from './renderer-health';

function fakePage(probes: RendererProbe[], evaluateDelayMs = 0) {
	let i = 0;
	const page = {
		evaluate: vi.fn(async () => {
			if (evaluateDelayMs) await new Promise(r => setTimeout(r, evaluateDelayMs));
			return probes[Math.min(i++, probes.length - 1)];
		}),
		reload: vi.fn(async () => null),
	};
	return page;
}

describe('ensureRendererAlive', () => {
	it('does nothing when the page schedules a frame', async () => {
		const page = fakePage([{ ok: true, visibility: 'visible', waitedMs: 3 }]);

		const result = await ensureRendererAlive(page, { timeoutMs: 2_000 });

		expect(result).toEqual({ ok: true, reloaded: false, visibility: 'visible', waitedMs: 3 });
		expect(page.reload).not.toHaveBeenCalled();
	});

	it('reloads once when no frame arrives and reports the visibility state it saw', async () => {
		const warn = vi.fn();
		const page = fakePage([
			{ ok: false, visibility: 'hidden', waitedMs: 2_000 },
			{ ok: true, visibility: 'visible', waitedMs: 5 },
		]);

		const result = await ensureRendererAlive(page, { timeoutMs: 2_000, warn });

		expect(page.reload).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: true, reloaded: true, visibility: 'visible', waitedMs: 5 });
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no animation frame.*hidden/i));
	});

	it('treats an evaluate that never returns as a frozen renderer and reloads', async () => {
		const page = fakePage([{ ok: true, visibility: 'visible', waitedMs: 1 }], 400);
		// first evaluate hangs past the Node-side deadline (timeoutMs + grace), second answers
		page.evaluate
			.mockImplementationOnce(() => new Promise(() => {}))
			.mockImplementationOnce(async () => ({ ok: true, visibility: 'visible', waitedMs: 1 }));

		const result = await ensureRendererAlive(page, { timeoutMs: 50, graceMs: 50 });

		expect(page.reload).toHaveBeenCalledTimes(1);
		expect(result.reloaded).toBe(true);
		expect(result.ok).toBe(true);
	});

	it('gives up after one reload and returns ok=false so the caller can decide', async () => {
		const page = fakePage([{ ok: false, visibility: 'visible', waitedMs: 2_000 }]);

		const result = await ensureRendererAlive(page, { timeoutMs: 2_000 });

		expect(page.reload).toHaveBeenCalledTimes(1);
		expect(result.ok).toBe(false);
		expect(result.reloaded).toBe(true);
	});
});
