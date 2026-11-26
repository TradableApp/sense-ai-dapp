import type { BrowserOptions, ErrorEvent, Exception } from '@sentry/react';

import scrubSecrets from '@/lib/scrubSecrets';

/**
 * What an event says before it is sent. A library error's message can name the RPC
 * endpoint with its provider key and a batch's call data with the wallet address; the error
 * boundary would send it as it is. So every text field is scrubbed, nested data that cannot
 * be scrubbed with certainty is dropped, and the request body is dropped (it can hold
 * encrypted payloads). So are an exception's mechanism data, the request's cookies and
 * environment, and each span's links: their values are of any shape. Stack frames and the exception type are kept: the frames point at
 * the app's own files and are what make the report useful. So are real-shaped trace and
 * span ids, which carry nothing but are what link a transaction to its spans and errors.
 * Not touched: the user, the fingerprint, frame variables and breadcrumb categories (none
 * is set to anything secret here; breadcrumbs are scrubbed by `beforeBreadcrumb`).
 *
 * An event that cannot be read is dropped whole: sending it raw would be the leak this
 * exists to prevent, and a partly scrubbed event cannot be told apart from a whole one.
 */

type Primitive = string | number | boolean;
/** What `beforeSendTransaction` is given; the SDK does not export the type by name here. */
export type TransactionEvent = Parameters<NonNullable<BrowserOptions['beforeSendTransaction']>>[0];

const scrubText = (value: string | undefined) =>
	value === undefined ? undefined : scrubSecrets(value);

/** Strings scrubbed, numbers and booleans kept, anything nested dropped. */
function scrubFlat(record: object | undefined): Record<string, Primitive> | undefined {
	if (!record) return undefined;
	return Object.fromEntries(
		Object.entries(record).flatMap(([key, value]): [string, Primitive][] => {
			if (typeof value === 'string') return [[key, scrubSecrets(value)]];
			if (typeof value === 'number' || typeof value === 'boolean') return [[key, value]];
			return [];
		}),
	);
}

/**
 * The ids that link a transaction to its spans and errors, by the shape the SDK makes them:
 * 32 lower-case hex characters for a trace, 16 for a span. The scrub would turn them into
 * `<hex>` and Sentry could link nothing. Kept only in the trace context and only when exactly
 * that shape; anything else under those names is scrubbed as any other text.
 */
const TRACE_IDS: Record<string, RegExp> = {
	trace_id: /^[0-9a-f]{32}$/,
	span_id: /^[0-9a-f]{16}$/,
	parent_span_id: /^[0-9a-f]{16}$/,
};

function scrubTraceContext(context: object | undefined): Record<string, Primitive> | undefined {
	const scrubbed = scrubFlat(context);
	if (!context || !scrubbed) return scrubbed;
	const kept = Object.entries(context).filter(
		([key, value]) => typeof value === 'string' && TRACE_IDS[key]?.test(value),
	);
	return { ...scrubbed, ...Object.fromEntries(kept) };
}

function scrubContexts(contexts: ErrorEvent['contexts']): ErrorEvent['contexts'] {
	if (!contexts) return undefined;
	return Object.fromEntries(
		Object.entries(contexts).map(([name, context]) => [
			name,
			name === 'trace' ? scrubTraceContext(context) : scrubFlat(context),
		]),
	);
}

/** The mechanism without its `data`, which a handler fills with whatever it caught. */
function withoutMechanismData(mechanism: NonNullable<Exception['mechanism']>) {
	const { data: _dropped, ...rest } = mechanism;
	return rest;
}

function scrubException(exception: Exception): Exception {
	const scrubbed = { ...exception, value: scrubText(exception.value) };
	return exception.mechanism
		? { ...scrubbed, mechanism: withoutMechanismData(exception.mechanism) }
		: scrubbed;
}

function scrubRequest(request: ErrorEvent['request']): ErrorEvent['request'] {
	if (!request) return undefined;
	// Cookies and the environment are name and value pairs no pattern can tell from a secret.
	const { cookies: _cookies, env: _env, ...rest } = request;
	return {
		...rest,
		url: scrubText(request.url),
		// A query is all parameters (`key=…`), which no pattern can tell from a secret.
		query_string: undefined,
		headers:
			request.headers &&
			Object.fromEntries(
				Object.entries(request.headers).map(([name, value]) => [name, scrubSecrets(value)]),
			),
		data: undefined,
	};
}

/** The text fields every event has, scrubbed. */
function scrubCommon<T extends ErrorEvent | TransactionEvent>(event: T): T {
	return {
		...event,
		message: scrubText(event.message),
		transaction: scrubText(event.transaction),
		extra: scrubFlat(event.extra),
		tags: scrubFlat(event.tags),
		contexts: scrubContexts(event.contexts),
		request: scrubRequest(event.request),
	};
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent | null {
	try {
		const scrubbed = scrubCommon(event);
		const { exception, logentry } = event;
		return {
			...scrubbed,
			exception: exception && { ...exception, values: exception.values?.map(scrubException) },
			// The parameters fill the message in and cannot be scrubbed with certainty.
			logentry: logentry && { message: scrubText(logentry.message) },
		};
	} catch {
		return null;
	}
}

export type SpanJson = NonNullable<TransactionEvent['spans']>[number];

/**
 * Span data the SDK sets on every fetch span that no pattern can scrub with certainty: a query
 * is all parameters (`key=…`), a fragment is free text and a host label can be the key.
 */
const DROPPED_SPAN_DATA = new Set(['http.query', 'http.fragment', 'server.address']);

function scrubSpan(span: SpanJson): SpanJson {
	const data = Object.fromEntries(
		Object.entries(span.data ?? {}).filter(([key]) => !DROPPED_SPAN_DATA.has(key)),
	);
	// Links carry attributes of any shape, set by whatever made them: dropped whole.
	const { links: _links, ...rest } = span;
	// The span's own ids are top-level fields, not data, and are kept as they are.
	return { ...rest, description: scrubText(span.description), data: scrubFlat(data) ?? {} };
}

/**
 * A span before it is sent, wherever it is sent from: the SDK runs `beforeSendSpan` on a
 * transaction's spans and on a span it sends on its own (an interaction's, named after the
 * element that was used, attributes included), which never reaches `beforeSendTransaction`.
 * The same scrub as a transaction's spans. The SDK cannot drop a span here (given nothing back
 * it sends the span as it was), so one that cannot be read is sent with its ids, times and op only.
 */
export function scrubSpanJson(span: SpanJson): SpanJson {
	try {
		return scrubSpan(span);
	} catch {
		return {
			span_id: span.span_id,
			trace_id: span.trace_id,
			parent_span_id: span.parent_span_id,
			start_timestamp: span.start_timestamp,
			timestamp: span.timestamp,
			op: span.op,
			data: {},
		};
	}
}

export function scrubTransactionEvent(event: TransactionEvent): TransactionEvent | null {
	try {
		return { ...scrubCommon(event), spans: event.spans?.map(scrubSpan) };
	} catch {
		return null;
	}
}
