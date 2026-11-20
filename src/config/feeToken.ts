import type { Abi } from 'viem';

import ableTokenLogo from '@/assets/able-token-logo.svg';
import senseLogo from '@/assets/logos/senseai-logo.svg';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';

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
	defaultPlanLimit: DefaultPlanLimit;
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
		// It can only be spent here, so the limit offered is all of it: no price is needed
		// to size it, and a larger approval gives nobody a way to move it elsewhere.
		defaultPlanLimit: { kind: 'walletBalance', whenEmpty: 25 },
	},
	ABLE: {
		symbol: 'ABLE',
		name: 'ABLE Token',
		icon: ableTokenLogo,
		abi: AbleTokenABI.abi as Abi,
		showsMarketValue: true,
		transferable: true,
		purchasable: true,
		defaultPlanLimit: { kind: 'fixed', amount: 1000 },
	},
} as const satisfies Record<string, FeeTokenProfile>;

/**
 * The ABI that declares the refusal a token with restricted transfers raises. Kept apart
 * from the selected profile so the refusal is recognised whichever token a build is for.
 */
export const TRANSFER_RESTRICTION_ABI: Abi = SenseTokenABI.abi as Abi;

/**
 * The profile a build setting names. Anything but a known name is SENSE: a build that
 * forgot the setting then shows no price and no send button, which is wrong for nobody.
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

export const FEE_TOKEN: FeeTokenProfile = selectFeeToken(import.meta.env.VITE_FEE_TOKEN);
