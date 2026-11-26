import * as Sentry from '@sentry/react';

import { scrubErrorEvent, scrubSpanJson, scrubTransactionEvent } from '@/config/sentryEvent';
import { LIVE_PERFORMANCE_ENTRIES } from '@/lib/liveReasoning/performanceMarks';
import scrubSecrets from '@/lib/scrubSecrets';

const TRACE_RATES: Record<string, number> = {
	localnet: 1.0,
	testnet: 0.5,
	mainnet: 0.05,
};

const ERROR_RATES: Record<string, number> = {
	localnet: 1.0,
	testnet: 1.0,
	mainnet: 1.0,
};

type Breadcrumb = Sentry.Breadcrumb;
type DataValue = NonNullable<Breadcrumb['data']>[string];

/** A breadcrumb's data with strings scrubbed and anything nested dropped. */
function scrubData(data: Record<string, DataValue>): Record<string, DataValue> {
	return Object.fromEntries(
		Object.entries(data).flatMap(([key, value]): [string, DataValue][] => {
			if (typeof value === 'string') return [[key, scrubSecrets(value)]];
			if (typeof value === 'number' || typeof value === 'boolean') return [[key, value]];
			return [];
		}),
	);
}

/**
 * Sentry's default breadcrumbs (console lines, fetch and XHR requests) go with every event.
 * A request's URL is the RPC endpoint, which can carry the provider's key, and a console
 * line can hold thirdweb's batch text, with the wallet address and call data. So every
 * message and every string in the data is scrubbed, and anything nested (a console line's
 * raw arguments) is dropped: it repeats the message and cannot be scrubbed with certainty.
 * A breadcrumb that cannot be read is dropped rather than sent as it is.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
	try {
		const { message, data } = breadcrumb;
		return {
			...breadcrumb,
			...(message !== undefined && { message: scrubSecrets(message) }),
			...(data !== undefined && { data: scrubData(data) }),
		};
	} catch {
		return null;
	}
}

export function initSentry() {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE;
	const tracesSampleRate = TRACE_RATES[environment] ?? 0.1;
	const sampleRate = ERROR_RATES[environment] ?? 1.0;

	Sentry.init({
		dsn,
		environment,
		integrations: [
			// Every performance mark and measure would become a span named after it; the live
			// reasoning timing marks carry an answer id and are left out.
			Sentry.browserTracingIntegration({
				ignorePerformanceApiSpans: [...LIVE_PERFORMANCE_ENTRIES],
			}),
		],
		tracesSampleRate,
		sampleRate,
		beforeBreadcrumb: scrubBreadcrumb,
		// Scrubbed text only, and no request body (it can hold encrypted payloads).
		beforeSend: scrubErrorEvent,
		beforeSendTransaction: scrubTransactionEvent,
		// Also a span sent outside a transaction, which beforeSendTransaction never sees.
		beforeSendSpan: scrubSpanJson,
	});
}
