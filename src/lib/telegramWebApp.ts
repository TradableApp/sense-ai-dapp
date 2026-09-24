/**
 * Conditional loader for the Telegram Mini App SDK.
 *
 * The SDK used to be a blocking `<script src="https://telegram.org/...">` in index.html, so it
 * ran for every visitor on every page load regardless of how they arrived. That handed a
 * third-party origin script execution inside the dApp's own context — where it can read tokens,
 * touch storage and observe the DOM — and made telegram.org a render-blocking dependency of a
 * page that, for almost every session, has nothing to do with Telegram.
 *
 * The Mini App itself is real and must keep working (firebase.json's frame-ancestors allows
 * web.telegram.org), so this loads the SDK on demand instead of removing it.
 */

export const TELEGRAM_SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

/** The shape App.tsx actually uses. Deliberately narrow — this is not a full SDK typing. */
export interface TelegramWebApp {
	ready: () => void;
	expand?: () => void;
}

/**
 * Are we running as a Telegram Mini App?
 *
 * Three independent signals, because no single one covers every client:
 *   - the launch hash Telegram appends (`tgWebAppData`, `tgWebAppStartParam`, and others
 *     depending on how the app was opened). Matched on the family rather than a list of names:
 *     enumerating them missed a deep link that arrives carrying only `tgWebAppStartParam`. The
 *     `[#&]` delimiter and the required uppercase segment keep an ordinary route containing the
 *     text "tgWebApp" from triggering a third-party script load;
 *   - `TelegramWebviewProxy`, injected by Telegram's native in-app webview;
 *   - `__telegram__initParams` in sessionStorage, which the SDK persists — this is what keeps
 *     the Mini App working after an in-app navigation drops the hash.
 */
export function isTelegramContext(): boolean {
	try {
		const hash = window.location.hash ?? '';
		if (/[#&]tgWebApp[A-Z][^&=]*=/.test(hash)) return true;

		if ((window as unknown as Record<string, unknown>).TelegramWebviewProxy) return true;

		return sessionStorage.getItem('__telegram__initParams') !== null;
	} catch {
		// sessionStorage throws in some privacy modes. Not-Telegram is the safe answer: it costs a
		// Mini App user a degraded launch, where the opposite costs every user a third-party script.
		return false;
	}
}

let pending: Promise<TelegramWebApp | null> | null = null;

/**
 * Load the SDK if — and only if — we are in Telegram, and resolve its WebApp object.
 *
 * Resolves `null` rather than rejecting on every failure path, because no Telegram outage should
 * be able to stop the dApp booting. The caller treats null as "not a Mini App session".
 */
export function loadTelegramWebApp(): Promise<TelegramWebApp | null> {
	if (!isTelegramContext()) return Promise.resolve(null);

	const existing = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
		?.WebApp;
	if (existing) return Promise.resolve(existing);

	// Memoised so React's effects — which run twice under StrictMode — inject one script, not two.
	if (pending) return pending;

	pending = new Promise<TelegramWebApp | null>(resolve => {
		const script = document.createElement('script');
		script.src = TELEGRAM_SDK_URL;
		script.async = true;
		script.onload = () => {
			resolve(
				(window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null,
			);
		};
		script.onerror = () => {
			// Clear the memo so a later call can retry. The memo is there to stop StrictMode's
			// double effect injecting two scripts, not to record an outage for the life of the
			// page — leaving it set strands a Mini App user on a cached null after one timeout.
			// The dead tag goes with it, so retries replace it rather than accumulate.
			// Resolve FIRST. This runs in an event handler, not the executor, so a throw here does
			// not reject the promise — it escapes and leaves the promise permanently unsettled,
			// hanging every awaiting caller. Cleanup must not be able to do that.
			pending = null;
			resolve(null);
			script.remove();
		};
		document.head.appendChild(script);
	});

	return pending;
}

/** Test seam: forget the memoised load so each case starts clean. */
export function resetTelegramWebAppLoader(): void {
	pending = null;
}
