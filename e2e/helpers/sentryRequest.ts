/**
 * Whether an address is one the page sends Sentry reports to.
 *
 * The host is read from the parsed address, so a page that only mentions the name in a path or a
 * query is not taken for Sentry. A local DSN has another host and is known by `ingest` as a
 * label of its host or a segment of its path; a query that mentions the word is not.
 */
export function isSentryUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const { hostname, pathname } = parsed;
	if (hostname === 'sentry.io' || hostname.endsWith('.sentry.io')) return true;
	return hostname.split('.').includes('ingest') || pathname.split('/').includes('ingest');
}
