import { sessionSiteFor } from '@/features/auth/sessionMessage';

/**
 * Whether a page at `origin` may ask the wallet for the session signature in a build of
 * `mode`. The message names one site per network, so asking for it anywhere else would ask
 * the user to sign text that says never to sign it there.
 *
 * - `mainnet`: only the site the message names. Other hosts that serve the same build (the
 *   hosting provider's default domains) are shown a link to it instead.
 * - `testnet`, `localnet` and `test`: the site, or this machine (`localhost`, `127.0.0.1`,
 *   `[::1]`, any port, http or https), where dev servers, previews and the e2e runs serve
 *   these builds.
 * - Any other mode: nowhere (its message cannot be built either).
 *
 * Pure: the caller passes `window.location.origin`.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_PROTOCOLS = new Set(['http:', 'https:']);
const MODES_ALLOWING_LOOPBACK = new Set(['testnet', 'localnet', 'test']);

const parse = (origin: string): URL | null => {
	try {
		return new URL(origin);
	} catch {
		return null;
	}
};

export function isSessionOriginAllowed(mode: string, origin: string): boolean {
	const site = sessionSiteFor(mode);
	const page = parse(origin);
	if (!site || !page) return false;
	if (page.origin === site) return true;
	return (
		MODES_ALLOWING_LOOPBACK.has(mode) &&
		LOOPBACK_PROTOCOLS.has(page.protocol) &&
		LOOPBACK_HOSTS.has(page.hostname)
	);
}
