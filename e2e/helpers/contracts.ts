/** Shared contract constants + account preparation for specs that exercise the
 *  plan/escrow path. Single source of truth — several specs previously each
 *  re-declared the env-derived addresses and the fund→activate ritual. */
import { activatePlan, fundABLE } from './hardhat';

export const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
export const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';

// Scales a WHOLE-TOKEN count to wei. Accepts bigint as well as number so a caller holding
// a whole-token count as a bigint needs no BigInt -> Number -> BigInt round-trip, which
// silently truncates above 2^53. NOTE: the argument is whole tokens, never a wei amount —
// passing an already-scaled on-chain value multiplies by 1e18 a second time.
export const ABLE = (whole: number | bigint): bigint => 10n ** 18n * BigInt(whole);
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
