import * as Sentry from '@sentry/react';

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

// eslint-disable-next-line import/prefer-default-export
export function initSentry() {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE;
	const tracesSampleRate = TRACE_RATES[environment] ?? 0.1;
	const sampleRate = ERROR_RATES[environment] ?? 1.0;

	Sentry.init({
		dsn,
		environment,
		integrations: [Sentry.browserTracingIntegration()],
		tracesSampleRate,
		sampleRate,
		beforeSend(event) {
			// Strip request body — may contain encrypted payloads; not useful for debugging
			// eslint-disable-next-line no-param-reassign
			if (event.request?.data) event.request.data = undefined;
			return event;
		},
	});
}
