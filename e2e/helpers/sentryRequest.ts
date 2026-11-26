/**
 * Whether an address is one the page sends Sentry reports to.
 *
 * The host is read from the parsed address, so a page that only mentions the name in a path or a
 * query is not taken for Sentry. A local DSN has another host and is known by `ingest`.
 */
export function isSentryUrl(url: string): boolean {
	let hostname: string;
	try {
		({ hostname } = new URL(url));
	} catch {
		return false;
	}
	return hostname === 'sentry.io' || hostname.endsWith('.sentry.io') || url.includes('ingest');
}
