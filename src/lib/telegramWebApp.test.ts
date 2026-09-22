import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isTelegramContext, loadTelegramWebApp, TELEGRAM_SDK_URL } from './telegramWebApp';

/**
 * The Telegram Mini App SDK was loaded from telegram.org by a blocking <script> in index.html —
 * on every page load, for every visitor, whether or not they came from Telegram. That is a
 * third-party origin given script execution in the dApp's own context, plus a render-blocking
 * request and a reachability dependency, for a feature almost no session uses.
 *
 * It must still work inside Telegram, so the fix is conditional loading, not removal.
 */

function resetWindow() {
	window.location.hash = '';
	delete (window as unknown as Record<string, unknown>).Telegram;
	delete (window as unknown as Record<string, unknown>).TelegramWebviewProxy;
	try {
		sessionStorage.clear();
	} catch {
		/* not available in every environment */
	}
	document.querySelectorAll(`script[src="${TELEGRAM_SDK_URL}"]`).forEach(s => s.remove());
}

beforeEach(resetWindow);
afterEach(() => {
	resetWindow();
	vi.restoreAllMocks();
});

describe('isTelegramContext', () => {
	it('is false for an ordinary web visit', () => {
		expect(isTelegramContext()).toBe(false);
	});

	it('detects the tgWebAppData launch hash', () => {
		window.location.hash = '#tgWebAppData=query_id%3DAAH&tgWebAppVersion=7.0';

		expect(isTelegramContext()).toBe(true);
	});

	it('detects the tgWebAppPlatform hash used by some clients', () => {
		window.location.hash = '#tgWebAppPlatform=tdesktop';

		expect(isTelegramContext()).toBe(true);
	});

	it("detects Telegram's in-app webview proxy", () => {
		(window as unknown as Record<string, unknown>).TelegramWebviewProxy = {};

		expect(isTelegramContext()).toBe(true);
	});

	it('detects a return visit whose init params were persisted', () => {
		// Telegram's own SDK writes this; it survives an in-app navigation that drops the hash.
		sessionStorage.setItem('__telegram__initParams', '{"tgWebAppVersion":"7.0"}');

		expect(isTelegramContext()).toBe(true);
	});

	it('is not fooled by an unrelated hash', () => {
		window.location.hash = '#/chat/tgWebApp-lookalike';

		expect(isTelegramContext()).toBe(false);
	});
});

describe('loadTelegramWebApp', () => {
	it('injects nothing for an ordinary web visitor', async () => {
		const result = await loadTelegramWebApp();

		expect(result).toBeNull();
		expect(document.querySelector(`script[src="${TELEGRAM_SDK_URL}"]`)).toBeNull();
	});

	it('injects the SDK when launched from Telegram and resolves the WebApp', async () => {
		window.location.hash = '#tgWebAppData=query_id%3DAAH';

		const pending = loadTelegramWebApp();
		const script = document.querySelector<HTMLScriptElement>(
			`script[src="${TELEGRAM_SDK_URL}"]`,
		);
		expect(script, 'SDK script was not injected').not.toBeNull();

		// Stand in for the real SDK, which defines window.Telegram before firing onload.
		(window as unknown as Record<string, unknown>).Telegram = { WebApp: { ready: () => {} } };
		script?.onload?.(new Event('load'));

		expect(await pending).toEqual({ ready: expect.any(Function) });
	});

	it('injects the SDK only once across repeated calls', async () => {
		window.location.hash = '#tgWebAppData=query_id%3DAAH';

		void loadTelegramWebApp();
		void loadTelegramWebApp();

		expect(document.querySelectorAll(`script[src="${TELEGRAM_SDK_URL}"]`)).toHaveLength(1);
	});

	it('resolves null rather than hanging when the SDK fails to load', async () => {
		// telegram.org being unreachable must degrade the Mini App, never block the dApp booting.
		window.location.hash = '#tgWebAppData=query_id%3DAAH';

		const pending = loadTelegramWebApp();
		const script = document.querySelector<HTMLScriptElement>(
			`script[src="${TELEGRAM_SDK_URL}"]`,
		);
		script?.onerror?.(new Event('error'));

		expect(await pending).toBeNull();
	});
});
