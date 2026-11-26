import { describe, expect, it } from 'vitest';

import { isSentryUrl } from './sentryRequest';

describe('isSentryUrl', () => {
	it('knows Sentry by the host of the parsed address', () => {
		expect(isSentryUrl('https://sentry.io/api/1/envelope/')).toBe(true);
		expect(isSentryUrl('https://o123.ingest.us.sentry.io/api/1/envelope/')).toBe(true);
	});

	it('knows a local DSN, whose host is not Sentry, by `ingest` in its address', () => {
		expect(isSentryUrl('http://localhost:9000/ingest/api/1/envelope/')).toBe(true);
	});

	it('does not take a page that only mentions the name in a path or a query for Sentry', () => {
		expect(isSentryUrl('https://example.test/sentry.io/collect')).toBe(false);
		expect(isSentryUrl('https://example.test/?next=https://sentry.io')).toBe(false);
		expect(isSentryUrl('https://sentry.io.example.test/api')).toBe(false);
	});

	it('does not take `ingest` in a query, or inside a longer word, for a local DSN', () => {
		expect(isSentryUrl('https://example.test/collect?source=ingest')).toBe(false);
		expect(isSentryUrl('https://example.test/ingestion/items')).toBe(false);
		expect(isSentryUrl('https://ingest.example.test/api/1/envelope/')).toBe(true);
	});

	it('answers false for text that is not an address', () => {
		expect(isSentryUrl('not an address')).toBe(false);
	});
});
