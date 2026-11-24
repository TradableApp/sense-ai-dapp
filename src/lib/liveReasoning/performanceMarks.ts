/**
 * The `performance` entries the live reasoning overlay records, read by the e2e suite: the
 * moment the first answer frame arrived, the moment the stored answer landed, and the measure
 * between them. Each name carries the answer id.
 *
 * Sentry's browser tracing turns every mark and measure into a span named after it, so these
 * names are given to it as `ignorePerformanceApiSpans` (`src/config/sentry.ts`) and never sent.
 */
const LIVE_ANSWER = 'live-answer:';
const STORED_ANSWER = 'stored-answer:';
const LEAD = 'live-answer-lead:';

export const liveAnswerMark = (id: string) => `${LIVE_ANSWER}${id}`;
export const storedAnswerMark = (id: string) => `${STORED_ANSWER}${id}`;
export const leadMeasure = (id: string) => `${LEAD}${id}`;

/** Every name above, whatever the id: for Sentry to leave out. */
export const LIVE_PERFORMANCE_ENTRIES: readonly RegExp[] = [LIVE_ANSWER, STORED_ANSWER, LEAD].map(
	prefix => new RegExp(`^${prefix}`),
);
