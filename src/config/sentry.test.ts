import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initSentry, scrubBreadcrumb } from './sentry';
import { scrubErrorEvent, scrubTransactionEvent } from './sentryEvent';

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
});
