import type { BrowserOptions, ErrorEvent, Exception } from '@sentry/react';

import scrubSecrets from '@/lib/scrubSecrets';

/**
 * What an event says before it is sent. A library error's message can name the RPC
 * endpoint with its provider key and a batch's call data with the wallet address; the error
 * boundary would send it as it is. So every text field is scrubbed, nested data that cannot
 * be scrubbed with certainty is dropped, and the request body is dropped (it can hold
 * encrypted payloads). Stack frames and the exception type are kept: the frames point at
 * the app's own files and are what make the report useful.
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

function scrubContexts(contexts: ErrorEvent['contexts']): ErrorEvent['contexts'] {
	if (!contexts) return undefined;
	return Object.fromEntries(
		Object.entries(contexts).map(([name, context]) => [name, scrubFlat(context)]),
	);
}

function scrubException(exception: Exception): Exception {
	return { ...exception, value: scrubText(exception.value) };
}

function scrubRequest(request: ErrorEvent['request']): ErrorEvent['request'] {
	if (!request) return undefined;
	return {
		...request,
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

type SpanJson = NonNullable<TransactionEvent['spans']>[number];

function scrubSpan(span: SpanJson): SpanJson {
	return { ...span, description: scrubText(span.description), data: scrubFlat(span.data) ?? {} };
}

export function scrubTransactionEvent(event: TransactionEvent): TransactionEvent | null {
	try {
		return { ...scrubCommon(event), spans: event.spans?.map(scrubSpan) };
	} catch {
		return null;
	}
}
