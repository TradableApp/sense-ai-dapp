/**
 * When the stored answer lands, what was shown live is compared with it. The stored record is
 * always what is rendered; a difference is only reported (`liveReport.ts`), once per answer.
 *
 * Only a run that finished answering is compared: before `done answered` the live view may
 * simply be behind (the sync can land before the last frames arrive), and a difference then
 * says nothing about the oracle.
 */
import type { LiveAnswerState } from '@/lib/liveReasoning/liveReducer';
import { type MismatchKind, reportMismatch } from '@/lib/liveReasoning/liveReport';

export { forgetLiveReports } from '@/lib/liveReasoning/liveReport';

export interface StoredAnswer {
	content?: string | null;
	reasoning?: ReadonlyArray<{ title: string; description: string; attempt?: number }>;
	sources?: ReadonlyArray<{ title: string; url: string; attempt?: number }>;
}

export type Comparison =
	| { kind: 'match' }
	| { kind: 'not-comparable' }
	| { kind: 'mismatch'; mismatch: MismatchKind };

/** An item stored before attempts were recorded belongs to attempt 1. */
const attemptOf = (item: { attempt?: number }) => item.attempt ?? 1;

const sameSteps = (live: LiveAnswerState['steps'], stored: NonNullable<StoredAnswer['reasoning']>) =>
	live.every(
		(step, i) =>
			step.title === stored[i].title &&
			step.description === stored[i].description &&
			step.attempt === attemptOf(stored[i]),
	);

const sameSources = (live: LiveAnswerState['sources'], stored: NonNullable<StoredAnswer['sources']>) =>
	live.every(
		(source, i) =>
			source.title === stored[i].title &&
			source.url === stored[i].url &&
			source.attempt === attemptOf(stored[i]),
	);

const mismatch = (kind: MismatchKind): Comparison => ({ kind: 'mismatch', mismatch: kind });

export function compareLiveWithStored(live: LiveAnswerState, stored: StoredAnswer): Comparison {
	if (live.outcome !== 'answered') return { kind: 'not-comparable' };
	const reasoning = stored.reasoning ?? [];
	const sources = stored.sources ?? [];
	if (live.steps.length !== reasoning.length) return mismatch('step-count');
	if (!sameSteps(live.steps, reasoning)) return mismatch('step-text');
	if (live.sources.length !== sources.length) return mismatch('source-count');
	if (!sameSources(live.sources, sources)) return mismatch('source-text');
	if (live.answer && live.answer.text !== (stored.content ?? '')) return mismatch('answer-text');
	return { kind: 'match' };
}

/** Compares, and reports a difference once per answer. Returns the comparison for the caller. */
export function reconcileWithStored(
	answerMessageId: string,
	live: LiveAnswerState,
	stored: StoredAnswer,
): Comparison {
	const comparison = compareLiveWithStored(live, stored);
	if (comparison.kind === 'mismatch') {
		reportMismatch(answerMessageId, comparison.mismatch, live.replica);
	}
	return comparison;
}
