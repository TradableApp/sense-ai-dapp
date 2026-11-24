import type { ChainName } from './chain';

/**
 * Hosts the dApp asks for while a page loads that are no part of the stack a localnet run starts:
 * the font stylesheet and its files, and the analytics scripts. `page.goto` resolves on the
 * browser's `load` event, and that event waits for every stylesheet and script the page has asked
 * for by then, so one request to one of these that never finishes fails a navigation that our own
 * services answered in milliseconds (T-REASON-02 on 2026-11-22: the app was drawn and waiting at
 * its connect button while an analytics script was still pending after 30 s).
 *
 * A name here is refused by the browser's resolver, so the request fails at once and the page
 * carries on as it does behind a content blocker. Nothing a spec reads is on this list.
 */
export const OFF_STACK_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', '*.posthog.com'];

/**
 * The Chromium arguments that keep a run from waiting on those hosts. Only the localnet gets them:
 * a testnet run measures the hosted build as a visitor loads it, and has the page-load budget for
 * it.
 */
export function offStackHostArgs(chain: ChainName): string[] {
	if (chain !== 'localnet') return [];
	const rules = OFF_STACK_HOSTS.map(host => `MAP ${host} ~NOTFOUND`).join(', ');
	return [`--host-resolver-rules=${rules}`];
}
