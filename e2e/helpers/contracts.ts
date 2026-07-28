/** Shared contract constants + account preparation for specs that exercise the
 *  plan/escrow path. Single source of truth — several specs previously each
 *  re-declared the env-derived addresses and the fund→activate ritual. */
import { activatePlan, fundABLE } from './hardhat';

export const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
export const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';

/** Above this, a "whole token" count is certainly an already-scaled wei value: total ABLE
 *  supply is 1e9, so 1e12 whole tokens is a thousand times the entire supply. */
const IMPLAUSIBLE_WHOLE_TOKENS = 10n ** 12n;

/**
 * Scales a WHOLE-TOKEN count to wei. The argument is whole tokens, NEVER a wei amount.
 *
 * Accepts `bigint` as well as `number` so a caller holding a whole-token count as a bigint
 * needs no `BigInt -> Number -> BigInt` round-trip, which silently truncates above 2^53.
 *
 * That widening costs a compile-time protection worth naming: while the signature was
 * `number`-only, `ABLE(ABLE(5))` was a type error, because the return is `bigint`. Now it
 * type-checks and would silently produce 5e36. The runtime guard below restores the
 * protection — a test helper should fail loudly rather than assert against a nonsense
 * number, and it catches the mistake at the call site instead of at the definition where a
 * comment cannot be seen.
 */
export const ABLE = (whole: number | bigint): bigint => {
	// Validate shape BEFORE converting: BigInt(1.5) throws a native RangeError, which is
	// accurate but neither names the call site nor says "whole-token count" the way the two
	// guards below do. ABLE(1.5) type-checks, so this is reachable.
	if (typeof whole === 'number' && !Number.isInteger(whole)) {
		throw new Error(
			`ABLE(${whole}) — argument must be a whole-token count; fractional tokens are not valid.`,
		);
	}
	const asBigInt = BigInt(whole);
	// Symmetric lower bound. Widening the signature to accept bigint also made ABLE(-1n) valid
	// TypeScript, and a negative slips past the upper bound to return -1e18 — which then fails
	// deep inside fundABLE or the contract as an opaque revert rather than here at the call
	// site. There is no legitimate negative token amount.
	if (asBigInt < 0n) {
		throw new Error(`ABLE(${asBigInt}) — argument must be a non-negative whole-token count.`);
	}
	if (asBigInt >= IMPLAUSIBLE_WHOLE_TOKENS) {
		throw new Error(
			`ABLE(${asBigInt}) — argument is whole TOKENS, not wei. ${asBigInt} whole tokens is ` +
				`far beyond the 1e9 total supply, so this is almost certainly an already-scaled ` +
				`value being scaled a second time (e.g. ABLE(ABLE(n)), or passing an on-chain ` +
				`balance). Pass the whole-token count instead.`,
		);
	}
	return 10n ** 18n * asBigInt;
};
export const PLAN_ALLOWANCE = ABLE(100);

/** The chat composer is plan-gated ("Activate Your Agent" renders instead when the
 *  account has no active plan). Give an account ABLE and an active plan in one
 *  call — the standard beforeEach precondition for specs that must be
 *  self-contained rather than depend on earlier projects' state (which reverts
 *  can silently undo). Call AFTER takeSnapshot() so a revert returns the ABLE. */
export async function fundAndActivatePlan(
	address: string,
	allowance: bigint = PLAN_ALLOWANCE,
): Promise<void> {
	if (!TOKEN_ADDRESS || !ESCROW_ADDRESS) {
		throw new Error(
			'fundAndActivatePlan: VITE_TOKEN_CONTRACT_ADDRESS / VITE_ESCROW_CONTRACT_ADDRESS not set — ' +
				'is the localnet stack up and .env.localnet synced (sense-ai-e2e sync-config)?',
		);
	}
	await fundABLE(TOKEN_ADDRESS, address, allowance);
	await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, address, allowance);
}
