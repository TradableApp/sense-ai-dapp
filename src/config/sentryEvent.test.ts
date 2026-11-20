import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import { scrubErrorEvent, scrubTransactionEvent, type TransactionEvent } from './sentryEvent';

// thirdweb's error text names the RPC endpoint, key included, and a batch's call data.
const KEY = 'KEY123abc';
const RPC = `https://84532.rpc.example/v2/${KEY}`;
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const THIRDWEB_MESSAGE = `HTTP request failed.\nURL: ${RPC}\nRequest body: {"params":[{"to":"${WALLET}"}]}`;

const leaks = (value: unknown) => {
	const text = JSON.stringify(value ?? null);
	return [KEY, 'rpc.example', WALLET.slice(2, 12)].filter(part => text.includes(part));
};

const errorEvent = (over: Partial<ErrorEvent> = {}): ErrorEvent => ({
	type: undefined,
	exception: {
		values: [
			{
				type: 'HttpRequestError',
				value: THIRDWEB_MESSAGE,
				stacktrace: { frames: [{ filename: 'https://app.example/assets/index.js', lineno: 1 }] },
			},
		],
	},
	message: `failed at ${RPC}`,
	logentry: { message: `RPC ${RPC} for ${WALLET}`, params: [RPC] },
	extra: { url: RPC, attempt: 2, nested: { url: RPC } },
	contexts: { rpc: { endpoint: RPC, code: -32000, deep: { url: RPC } } },
	transaction: `/chat?rpc=${RPC}`,
	request: { url: `${RPC}?q=1`, query_string: `key=${KEY}`, data: { secret: KEY } },
	...over,
});

describe('scrubErrorEvent', () => {
	it('leaves no RPC key or wallet address anywhere in the event', () => {
		const scrubbed = scrubErrorEvent(errorEvent());

		expect(scrubbed).not.toBeNull();
		expect(leaks(scrubbed)).toEqual([]);
	});

	it('scrubs the exception text and keeps its type and stack frames', () => {
		const value = scrubErrorEvent(errorEvent())?.exception?.values?.[0];

		expect(value?.value).toBe(
			'HTTP request failed.\nURL: <url>\nRequest body: {"params":[{"to":"<hex>"}]}',
		);
		expect(value?.type).toBe('HttpRequestError');
		expect(value?.stacktrace?.frames?.[0].filename).toBe('https://app.example/assets/index.js');
	});

	it('keeps numbers and drops nested data it cannot scrub with certainty', () => {
		const scrubbed = scrubErrorEvent(errorEvent());

		expect(scrubbed?.extra).toEqual({ url: '<url>', attempt: 2 });
		expect(scrubbed?.contexts?.rpc).toEqual({ endpoint: '<url>', code: -32000 });
		expect(scrubbed?.request?.data).toBeUndefined();
		expect(scrubbed?.logentry?.params).toBeUndefined();
	});

	it('scrubs a query string given as pairs', () => {
		const scrubbed = scrubErrorEvent(errorEvent({ request: { query_string: [['rpc', RPC]] } }));

		expect(leaks(scrubbed)).toEqual([]);
	});

	it('does not change the event it was given', () => {
		const event = errorEvent();

		scrubErrorEvent(event);

		expect(event.message).toContain(KEY);
	});

	// Sending it raw would be the leak this exists to prevent, so the whole event goes.
	it('drops an event it cannot read rather than sending it as it is', () => {
		const hostile = Object.defineProperty(errorEvent(), 'message', {
			enumerable: true,
			get() {
				throw new Error('getter');
			},
		});

		expect(scrubErrorEvent(hostile)).toBeNull();
	});
});

describe('scrubTransactionEvent', () => {
	it('scrubs the RPC URL from a request span and the transaction name', () => {
		const event: TransactionEvent = {
			type: 'transaction',
			transaction: `/chat?rpc=${RPC}`,
			spans: [
				{
					span_id: '1',
					trace_id: '2',
					start_timestamp: 0,
					description: `POST ${RPC}`,
					data: { 'http.url': RPC, 'http.response.status_code': 200 },
				},
			],
		};

		const scrubbed = scrubTransactionEvent(event);

		expect(leaks(scrubbed)).toEqual([]);
		expect(scrubbed?.spans?.[0].description).toBe('POST <url>');
		expect(scrubbed?.spans?.[0].data).toEqual({
			'http.url': '<url>',
			'http.response.status_code': 200,
		});
	});
});
