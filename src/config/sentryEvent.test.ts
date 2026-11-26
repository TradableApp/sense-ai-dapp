import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import scrubSecrets from '@/lib/scrubSecrets';

import {
	scrubErrorEvent,
	scrubSpanJson,
	scrubTransactionEvent,
	type SpanJson,
	type TransactionEvent,
} from './sentryEvent';

// thirdweb's error text names the RPC endpoint, key included, and a batch's call data.
const KEY = 'KEY123abc';
const RPC = `https://84532.rpc.example/v2/${KEY}`;
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const THIRDWEB_MESSAGE = `HTTP request failed.\nURL: ${RPC}\nRequest body: {"params":[{"to":"${WALLET}"}]}`;

// Real-shaped ids, as the SDK makes them: 32 and 16 lower-case hex characters.
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const PARENT_SPAN_ID = '00f067aa0ba902b7';

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
					span_id: SPAN_ID,
					trace_id: TRACE_ID,
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

describe('trace and span ids', () => {
	const trace = {
		trace_id: TRACE_ID,
		span_id: SPAN_ID,
		parent_span_id: PARENT_SPAN_ID,
		op: 'pageload',
		description: `GET ${RPC}`,
	};

	// Sentry links a transaction and its errors by these ids; scrubbed, nothing is linked.
	it.each([
		['an error event', (e: object) => scrubErrorEvent(errorEvent(e))],
		[
			'a transaction event',
			(e: object) => scrubTransactionEvent({ type: 'transaction', ...e } as TransactionEvent),
		],
	])('%s keeps real-shaped ids in the trace context and scrubs the rest', (_name, scrub) => {
		const scrubbed = scrub({ contexts: { trace } });

		expect(scrubbed?.contexts?.trace).toEqual({
			trace_id: TRACE_ID,
			span_id: SPAN_ID,
			parent_span_id: PARENT_SPAN_ID,
			op: 'pageload',
			description: 'GET <url>',
		});
	});

	// Anything else under those names is scrubbed as any other text is.
	it.each([
		['upper case', TRACE_ID.toUpperCase(), SPAN_ID.toUpperCase()],
		['too long', `${TRACE_ID}00`, `${SPAN_ID}00`],
		['swapped lengths', SPAN_ID, TRACE_ID],
		['a URL', RPC, RPC],
	])('scrubs ids that are not real-shaped (%s)', (_name, traceId, spanId) => {
		const scrubbed = scrubErrorEvent(
			errorEvent({
				contexts: { trace: { trace_id: traceId, span_id: spanId, parent_span_id: spanId } },
			}),
		);

		expect(scrubbed?.contexts?.trace).toEqual({
			trace_id: scrubSecrets(traceId),
			span_id: scrubSecrets(spanId),
			parent_span_id: scrubSecrets(spanId),
		});
		expect(scrubbed?.contexts?.trace?.trace_id).not.toBe(traceId);
		expect(scrubbed?.contexts?.trace?.span_id).not.toBe(spanId);
		expect(leaks(scrubbed)).toEqual([]);
	});

	it('keeps real-shaped ids under those names only in the trace context', () => {
		const scrubbed = scrubErrorEvent(errorEvent({ contexts: { other: { trace_id: TRACE_ID } } }));

		expect(scrubbed?.contexts?.other?.trace_id).not.toBe(TRACE_ID);
	});

	it("keeps a span's own ids", () => {
		const scrubbed = scrubTransactionEvent({
			type: 'transaction',
			spans: [
				{
					span_id: SPAN_ID,
					trace_id: TRACE_ID,
					parent_span_id: PARENT_SPAN_ID,
					start_timestamp: 0,
					data: {},
				},
			],
		});

		expect(scrubbed?.spans?.[0]).toMatchObject({
			span_id: SPAN_ID,
			trace_id: TRACE_ID,
			parent_span_id: PARENT_SPAN_ID,
		});
	});
});

describe('span data and tags', () => {
	// The SDK sets these on every fetch span; a query string or a host label can carry a key.
	it('drops http.query, http.fragment and server.address from span data', () => {
		const scrubbed = scrubTransactionEvent({
			type: 'transaction',
			spans: [
				{
					span_id: SPAN_ID,
					trace_id: TRACE_ID,
					start_timestamp: 0,
					data: {
						'http.query': `?apikey=${KEY}`,
						'http.fragment': `#${KEY}`,
						'server.address': `${KEY}.rpc.example`,
						'http.method': 'POST',
						'http.response.status_code': 200,
					},
				},
			],
		});

		expect(scrubbed?.spans?.[0].data).toEqual({
			'http.method': 'POST',
			'http.response.status_code': 200,
		});
	});

	it.each([
		['an error event', (e: object) => scrubErrorEvent(errorEvent(e))],
		[
			'a transaction event',
			(e: object) => scrubTransactionEvent({ type: 'transaction', ...e } as TransactionEvent),
		],
	])("%s has its tags' string values scrubbed", (_name, scrub) => {
		const scrubbed = scrub({ tags: { endpoint: RPC, chainId: '84532', retried: true, n: 2 } });

		expect(scrubbed?.tags).toEqual({ endpoint: '<url>', chainId: '84532', retried: true, n: 2 });
	});
});

describe('fields no pattern can scrub with certainty', () => {
	it("drops an exception's mechanism data and keeps its mechanism type", () => {
		const scrubbed = scrubErrorEvent(
			errorEvent({
				exception: {
					values: [
						{
							type: 'Error',
							value: 'boom',
							mechanism: { type: 'onerror', handled: false, data: { url: RPC, target: WALLET } },
						},
					],
				},
			}),
		);
		const mechanism = scrubbed?.exception?.values?.[0].mechanism;

		expect(mechanism).toEqual({ type: 'onerror', handled: false });
		expect(leaks(scrubbed)).toEqual([]);
	});

	it("drops the request's cookies and environment", () => {
		const scrubbed = scrubErrorEvent(
			errorEvent({
				request: { url: 'https://app.example/chat', cookies: { session: KEY }, env: { RPC } },
			}),
		);

		expect(scrubbed?.request).not.toHaveProperty('cookies');
		expect(scrubbed?.request).not.toHaveProperty('env');
		expect(leaks(scrubbed)).toEqual([]);
	});

	it("drops a span's links", () => {
		const scrubbed = scrubTransactionEvent({
			type: 'transaction',
			spans: [
				{
					span_id: SPAN_ID,
					trace_id: TRACE_ID,
					start_timestamp: 0,
					data: {},
					links: [{ trace_id: TRACE_ID, span_id: SPAN_ID, attributes: { 'peer.url': RPC } }],
				},
			],
		} as TransactionEvent);

		expect(scrubbed?.spans?.[0]).not.toHaveProperty('links');
		expect(leaks(scrubbed)).toEqual([]);
	});
});

// A span the SDK sends on its own (an interaction's, for one) is named after the element that
// was used, attributes included, and never passes through the transaction scrub.
describe('scrubSpanJson', () => {
	const span = (over: Partial<SpanJson> = {}): SpanJson => ({
		span_id: SPAN_ID,
		trace_id: TRACE_ID,
		parent_span_id: PARENT_SPAN_ID,
		start_timestamp: 1,
		timestamp: 2,
		op: 'ui.interaction.click',
		description: `body > div.chat > a[title="${RPC}?wallet=${WALLET}"]`,
		data: {
			transaction: `/chat?rpc=${RPC}`,
			'sentry.exclusive_time': 40,
			'http.query': `key=${KEY}`,
			'http.fragment': 'free text',
			'server.address': 'rpc.example',
			nested: [RPC],
		},
		measurements: { inp: { value: 40, unit: 'millisecond' } },
		is_segment: true,
		segment_id: SPAN_ID,
		...over,
	});

	it("scrubs the description and the string data, as a transaction's spans are", () => {
		const scrubbed = scrubSpanJson(span());

		expect(scrubbed.description).toBe(scrubSecrets(span().description ?? ''));
		expect(scrubbed.data.transaction).toBe(scrubSecrets(`/chat?rpc=${RPC}`));
		expect(leaks(scrubbed)).toEqual([]);
	});

	it('drops what the transaction scrub drops', () => {
		const scrubbed = scrubSpanJson(
			span({ links: [{ trace_id: TRACE_ID, span_id: SPAN_ID, attributes: { 'peer.url': RPC } }] }),
		);

		expect(Object.keys(scrubbed.data).sort()).toEqual(['sentry.exclusive_time', 'transaction']);
		expect(scrubbed).not.toHaveProperty('links');
	});

	it('keeps the ids, times, op and measurements as they are', () => {
		const scrubbed = scrubSpanJson(span());

		expect(scrubbed).toMatchObject({
			span_id: SPAN_ID,
			trace_id: TRACE_ID,
			parent_span_id: PARENT_SPAN_ID,
			start_timestamp: 1,
			timestamp: 2,
			op: 'ui.interaction.click',
			measurements: { inp: { value: 40, unit: 'millisecond' } },
			is_segment: true,
			segment_id: SPAN_ID,
		});
	});

	it('does not change the span it was given', () => {
		const given = span();
		const before = JSON.stringify(given);

		scrubSpanJson(given);

		expect(JSON.stringify(given)).toBe(before);
	});

	// The SDK cannot drop a span here: given nothing back it sends the span as it was.
	it('sends a span it cannot read with no description and no data', () => {
		const unreadable = {
			...span(),
			get data(): SpanJson['data'] {
				throw new Error('unreadable');
			},
		};

		const scrubbed = scrubSpanJson(unreadable);

		expect(scrubbed).not.toHaveProperty('description');
		expect(scrubbed.data).toEqual({});
		expect(scrubbed).toMatchObject({ span_id: SPAN_ID, trace_id: TRACE_ID, start_timestamp: 1 });
		expect(leaks(scrubbed)).toEqual([]);
	});

	it('gives back an empty span when no field of it can be read', () => {
		const unreadable = new Proxy({} as SpanJson, {
			get() {
				throw new Error(`cannot read a span that names ${RPC}`);
			},
		});

		expect(scrubSpanJson(unreadable)).toEqual({ data: {} });
	});
});
