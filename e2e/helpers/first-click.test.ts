// @vitest-environment node
//
// The first click in a fresh browser context can wait its whole timeout on a page that holds the
// button and has stopped painting, after the renderer probe has passed. The click did not land,
// so the helper reloads once and clicks again, and says what it saw.
import { describe, expect, it, vi } from 'vitest';

import { clickPastColdStall } from './first-click';

function timeoutError() {
	const error = new Error('locator.click: Timeout 15000ms exceeded.');
	error.name = 'TimeoutError';
	return error;
}

function fakes(clicks: Array<'lands' | Error>, inPage: number | Error = 1) {
	let i = 0;
	const order: string[] = [];
	const target = {
		click: vi.fn(async (_options?: { timeout?: number }) => {
			order.push('click');
			const outcome = clicks[Math.min(i++, clicks.length - 1)];
			if (outcome !== 'lands') throw outcome;
		}),
		count: vi.fn(async () => {
			if (inPage instanceof Error) throw inPage;
			return inPage;
		}),
	};
	const page = {
		reload: vi.fn(async () => {
			order.push('reload');
			return null;
		}),
	};
	return { target, page, order };
}

describe('clickPastColdStall', () => {
	it('clicks once and does not reload when the click lands', async () => {
		const { target, page } = fakes(['lands']);
		const warn = vi.fn();

		const result = await clickPastColdStall(page, target, { timeoutMs: 15_000, warn });

		expect(result).toEqual({ reloaded: false });
		expect(target.click).toHaveBeenCalledTimes(1);
		expect(target.click).toHaveBeenCalledWith({ timeout: 15_000 });
		expect(page.reload).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it('reloads once, runs the check and clicks again when the click times out', async () => {
		const { target, page, order } = fakes([timeoutError(), 'lands']);
		const warn = vi.fn();
		const afterReload = vi.fn(async () => {
			order.push('check');
		});

		const result = await clickPastColdStall(page, target, { warn, afterReload });

		expect(result).toEqual({ reloaded: true });
		expect(order).toEqual(['click', 'reload', 'check', 'click']);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/did not land.*in the page: yes/));
	});

	it('says when the target was not in the page', async () => {
		const { target, page } = fakes([timeoutError(), 'lands'], 0);
		const warn = vi.fn();

		await clickPastColdStall(page, target, { warn });

		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/in the page: no/));
	});

	it('still reloads when the page cannot say whether it holds the target', async () => {
		const { target, page } = fakes([timeoutError(), 'lands'], new Error('page closed'));
		const warn = vi.fn();

		const result = await clickPastColdStall(page, target, { warn });

		expect(result).toEqual({ reloaded: true });
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/in the page: unknown/));
	});

	it('still clicks again when the check after the reload throws, and says so by name', async () => {
		const { target, page, order } = fakes([timeoutError(), 'lands']);
		const warn = vi.fn();
		const failure = new Error('page.reload: navigation failed at http://localhost:3002/');
		failure.name = 'NavigationError';
		const afterReload = vi.fn(async () => {
			order.push('check');
			throw failure;
		});

		const result = await clickPastColdStall(page, target, { warn, afterReload });

		expect(result).toEqual({ reloaded: true });
		expect(order).toEqual(['click', 'reload', 'check', 'click']);
		expect(warn).toHaveBeenLastCalledWith(
			expect.stringMatching(/check after the reload.*NavigationError/),
		);
	});

	it('throws the second timeout: one recovery, never a loop', async () => {
		const second = timeoutError();
		const { target, page } = fakes([timeoutError(), second]);

		await expect(clickPastColdStall(page, target)).rejects.toBe(second);
		expect(page.reload).toHaveBeenCalledTimes(1);
		expect(target.click).toHaveBeenCalledTimes(2);
	});

	it('throws any other error at once, with no reload', async () => {
		const closed = new Error('Target page, context or browser has been closed');
		const { target, page } = fakes([closed]);
		const warn = vi.fn();

		await expect(clickPastColdStall(page, target, { warn })).rejects.toBe(closed);
		expect(page.reload).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});
