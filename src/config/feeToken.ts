import type { Abi } from 'viem';

import ableTokenLogo from '@/assets/able-token-logo.svg';
import senseLogo from '@/assets/logos/senseai-logo.svg';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';

import { type FeeTokenName } from './feeTokenConfig';

export { assertFeeTokenConfig, FeeTokenConfigError } from './feeTokenConfig';

/**
 * How the plan dialog picks the limit it first offers.
 * - `fixed`: the same amount for everyone.
 * - `walletBalance`: what the wallet holds, or `whenEmpty` for a wallet that holds none.
 */
export type DefaultPlanLimit =
	| { kind: 'fixed'; amount: number }
	| { kind: 'walletBalance'; whenEmpty: number };

/**
 * Everything the dApp does differently depending on which token pays the fees.
 *
 * The token is chosen once per build (`VITE_FEE_TOKEN`). Components read this profile and
 * never test for a particular token, so a build for another token changes nothing but the
 * setting. The `fee-token-literals` guard keeps token names out of the rest of `src/`.
 */
export interface FeeTokenProfile {
	symbol: string;
	/** The token's on-chain name, shown by the wallet panel. */
	name: string;
	icon: string;
	abi: Abi;
	/** Whether a market price exists and may be shown. When false no price is fetched. */
	showsMarketValue: boolean;
	/** Whether a holder can send it to another wallet. When false the send button is hidden. */
	transferable: boolean;
	/** Whether it can be bought. When false the wallet panel offers no purchase. */
	purchasable: boolean;
	/**
	 * Whether its owner can stop every transfer. When true the fee token check asks
	 * `paused()` and switches payments off while it says yes.
	 */
	pausable: boolean;
	defaultPlanLimit: DefaultPlanLimit;
	/** Decimal places of the token's base unit. Every amount is converted with this. */
	decimals: number;
	/**
	 * The price used for the dollar estimate on chains where no market exists. Only a
	 * token that shows a market value has one.
	 */
	plannedPriceUsd?: number;
}

export const FEE_TOKEN_PROFILES = {
	SENSE: {
		symbol: 'SENSE',
		name: 'SENSE',
		icon: senseLogo,
		abi: SenseTokenABI.abi as Abi,
		showsMarketValue: false,
		transferable: false,
		purchasable: false,
		pausable: true,
		// It has no price to size a limit by and no use but this one, so the limit offered is
		// what the wallet holds. The approval is still an approval: whoever controls the
		// escrow or its oracle could draw on it, up to that amount. That is accepted for a
		// credit that cannot be sold, and is why the other profile keeps a fixed amount.
		defaultPlanLimit: { kind: 'walletBalance', whenEmpty: 25 },
		decimals: 18,
	},
	ABLE: {
		symbol: 'ABLE',
		name: 'ABLE Token',
		icon: ableTokenLogo,
		abi: AbleTokenABI.abi as Abi,
		showsMarketValue: true,
		transferable: true,
		purchasable: true,
		pausable: true,
		defaultPlanLimit: { kind: 'fixed', amount: 1000 },
		decimals: 18,
		plannedPriceUsd: 0.015,
	},
} as const satisfies Record<FeeTokenName, FeeTokenProfile>;

/**
 * The ABI that declares the refusal a token with restricted transfers raises. Kept apart
 * from the selected profile so the refusal is recognised whichever token a build is for.
 */
export const TRANSFER_RESTRICTION_ABI: Abi = SenseTokenABI.abi as Abi;

/**
 * The profile a build setting names; anything but a known name is SENSE.
 *
 * The fallback exists for the unit tests only; every build must name its token. It is not
 * safe for a deployed build: SENSE settings on another token mean a wrong label, no value shown and
 * a first offer to approve the wallet's whole balance. `assertFeeTokenConfig` stops such a
 * build before it exists.
 */
export function selectFeeToken(value: string | undefined): FeeTokenProfile {
	const name = (value ?? '').trim().toUpperCase();
	return name === FEE_TOKEN_PROFILES.ABLE.symbol
		? FEE_TOKEN_PROFILES.ABLE
		: FEE_TOKEN_PROFILES.SENSE;
}

/** The limit the plan dialog first offers, in whole tokens. */
export function defaultPlanLimit(
	profile: FeeTokenProfile,
	walletBalance: number | undefined,
): number {
	const rule = profile.defaultPlanLimit;
	if (rule.kind === 'fixed') return rule.amount;
	const whole = Math.floor(walletBalance ?? 0);
	return Number.isFinite(whole) && whole >= 1 ? whole : rule.whenEmpty;
}

/**
 * Whether the plan dialog's first offer is the wallet's whole balance (every whole token
 * it holds), so the dialog can say so. False for a fixed offer, and for a wallet offered
 * the profile's fallback because it holds less than one whole token.
 */
export function offersFullBalance(
	profile: FeeTokenProfile,
	walletBalance: number | undefined,
): boolean {
	if (profile.defaultPlanLimit.kind !== 'walletBalance' || walletBalance === undefined)
		return false;
	return Math.floor(walletBalance) >= 1;
}

export const FEE_TOKEN: FeeTokenProfile = selectFeeToken(import.meta.env.VITE_FEE_TOKEN);
