import type { FeeTokenCheckState } from '@/lib/feeTokenCheck';

// Every state the fee token check can be in, for tests that go through all of them. The
// `satisfies` makes a verdict added to the type without a row here a type error, so no
// test can quietly skip it.
const EVERY_STATE = {
	ok: true,
	unknown: true,
	'escrow-uses-other-token': true,
	'symbol-mismatch': true,
	'escrow-not-exempt': true,
	'treasury-not-exempt': true,
} as const satisfies Record<FeeTokenCheckState, true>;

export const FEE_TOKEN_STATES = Object.keys(EVERY_STATE) as FeeTokenCheckState[];

/** The states that are a confirmed disagreement: everything but `ok` and `unknown`. */
export const DISAGREEING_STATES = FEE_TOKEN_STATES.filter(
	state => state !== 'ok' && state !== 'unknown',
);
