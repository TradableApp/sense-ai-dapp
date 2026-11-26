import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initSentry, scrubBreadcrumb } from './sentry';
import { scrubErrorEvent, scrubSpanJson, scrubTransactionEvent } from './sentryEvent';

vi.mock('@sentry/react', () => ({
	init: vi.fn(),
	browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}));

const RPC = 'https://84532.rpc.example/v2/KEY123abc';
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CALL_DATA = `0xa9059cbb000000000000000000000000${WALLET.slice(2)}`;

/** Every string in a breadcrumb, wherever it sits, for checking that nothing private is left. */
const textOf = (value: unknown): string => JSON.stringify(value ?? null);

const leaks = (value: unknown) => {
	const text = textOf(value);
	return ['KEY123abc', 'rpc.example', WALLET.slice(2, 12), CALL_DATA.slice(10, 30)].filter(part =>
		text.includes(part),
	);
};

describe('scrubBreadcrumb', () => {
	it.each(['fetch', 'xhr'])('removes the RPC URL from a %s request', category => {
		const breadcrumb = {
			category,
			type: 'http',
			data: { method: 'POST', url: RPC, status_code: 429 },
		};

		const scrubbed = scrubBreadcrumb(breadcrumb);

		expect(leaks(scrubbed)).toEqual([]);
		expect(scrubbed?.data).toEqual({ method: 'POST', url: '<url>', status_code: 429 });
	});

	it('removes the URL, the wallet and the call data from a console line, on every line', () => {
		const message = `RPC Error from ${RPC}:\nrequests: [{"to":"${WALLET}","data":"${CALL_DATA}"}]`;
		const breadcrumb = {
			category: 'console',
			level: 'error' as const,
			message,
			data: { arguments: [message, { to: WALLET, data: CALL_DATA }], logger: 'console' },
		};

		const scrubbed = scrubBreadcrumb(breadcrumb);

		expect(leaks(scrubbed)).toEqual([]);
		expect(scrubbed?.message).toBe(
			'RPC Error from <url>\nrequests: [{"to":"<hex>","data":"<hex>"}]',
		);
		expect(scrubbed?.data).toEqual({ logger: 'console' });
		expect(scrubbed?.level).toBe('error');
	});

	it('does not change the breadcrumb it was given', () => {
		const breadcrumb = { category: 'fetch', data: { url: RPC } };

		scrubBreadcrumb(breadcrumb);

		expect(breadcrumb.data.url).toBe(RPC);
	});

	it('leaves a breadcrumb with nothing private as it was', () => {
		const breadcrumb = { category: 'navigation', data: { from: '/chat', to: '/history' } };

		expect(scrubBreadcrumb(breadcrumb)).toEqual(breadcrumb);
	});

	it('drops a breadcrumb it cannot read rather than sending it as it is', () => {
		const hostile = Object.defineProperty({ category: 'console' }, 'message', {
			enumerable: true,
			get() {
				throw new Error('getter');
			},
		});

		expect(scrubBreadcrumb(hostile)).toBeNull();
	});
});

describe('initSentry', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it('scrubs every breadcrumb before it is kept', () => {
		vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');

		initSentry();

		expect(Sentry.init).toHaveBeenCalledWith(
			expect.objectContaining({ beforeBreadcrumb: scrubBreadcrumb }),
		);
	});

	it('scrubs every error and transaction event before it is sent', () => {
		vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');

		initSentry();

		expect(Sentry.init).toHaveBeenCalledWith(
			expect.objectContaining({
				beforeSend: scrubErrorEvent,
				beforeSendTransaction: scrubTransactionEvent,
			}),
		);
	});

	it('scrubs every span before it is sent, also one sent outside a transaction', () => {
		vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');

		initSentry();

		expect(Sentry.init).toHaveBeenCalledWith(
			expect.objectContaining({ beforeSendSpan: scrubSpanJson }),
		);
	});

	// Interaction spans are on by default and sent on their own, in a span envelope, which the
	// installed SDK builds through beforeSendSpan (and never through beforeSendTransaction).
	it('relies on the installed SDK running beforeSendSpan on spans sent on their own', () => {
		const fromBrowser = createRequire(require.resolve('@sentry/browser'));
		const core = fromBrowser('@sentry/core') as {
			SentrySpan: new (_context: object) => object;
			createSpanEnvelope: (_spans: object[], _client: object) => [object, Array<[object, unknown]>];
		};
		const url = 'https://rpc.example/v2/KEY123abc';
		const span = new core.SentrySpan({
			name: `body > a[title="${url}"]`,
			isStandalone: true,
			startTimestamp: 1,
			endTimestamp: 2,
		});
		const sent = (options: object) =>
			JSON.stringify(
				core.createSpanEnvelope([span], { getOptions: () => options, getDsn: () => undefined })[1],
			);

		expect(sent({})).toContain(url);
		expect(sent({ beforeSendSpan: scrubSpanJson })).not.toContain('rpc.example');
		expect(sent({ beforeSendSpan: scrubSpanJson })).not.toContain('KEY123abc');
	});

	describe('the live reasoning timing marks', () => {
		// The SDK as installed, reached through the browser package that depends on it.
		const fromBrowser = createRequire(require.resolve('@sentry/browser'));
		// The SDK's own matcher, as browser tracing applies it to each mark and measure.
		const { stringMatchesSomePattern } = fromBrowser('@sentry/core') as {
			stringMatchesSomePattern: (_value: string, _patterns: Array<string | RegExp>) => boolean;
		};
		const ignoredBy = (name: string) => {
			vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example/1');
			initSentry();
			const [options] = vi.mocked(Sentry.browserTracingIntegration).mock.calls[0] ?? [];
			return stringMatchesSomePattern(name, options?.ignorePerformanceApiSpans ?? []);
		};

		// The names the e2e suite reads, each carrying the answer id.
		it.each(['live-answer:42', 'stored-answer:42', 'live-answer-lead:42'])(
			'keeps %s, which names an answer id, out of the spans sent',
			name => {
				expect(ignoredBy(name)).toBe(true);
			},
		);

		it.each(['app-start', 'live-answers', 'my-live-answer:42'])('still sends %s', name => {
			expect(ignoredBy(name)).toBe(false);
		});

		it('relies on an option the installed SDK applies to marks and measures', () => {
			const metrics = path.join(
				path.dirname(fromBrowser.resolve('@sentry-internal/browser-utils/package.json')),
				'build/esm/metrics/browserMetrics.js',
			);
			const source = readFileSync(metrics, 'utf8');

			expect(source).toMatch(
				/\['mark', 'measure'\]\.includes\(entry\.entryType\) &&\s*stringMatchesSomePattern\(entry\.name, ignorePerformanceApiSpans\)/,
			);
		});
	});
});
