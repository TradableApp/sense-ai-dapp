import type { FeeTokenProfile } from '@/config/feeToken';

interface WalletSituation {
	/** The wallet's fee token balance in whole tokens, or undefined while it is not known. */
	balance: number | undefined;
	/** What the action needs, in whole tokens: in the plan dialog, the amount first offered. */
	needed: number;
	profile: FeeTokenProfile;
	/** Whether the faucet is offered on the wallet's chain. */
	isFaucetOffered: boolean;
}

/**
 * Whether to point the wallet to the community links: it holds less than it needs, and
 * the app offers no way to get some (the profile says it cannot be bought or sent, and no
 * faucet serves this chain). Decided by the profile's flags, never by which token it is.
 */
export default function pointsToCommunity({
	balance,
	needed,
	profile,
	isFaucetOffered,
}: WalletSituation): boolean {
	const canBeGotInApp = profile.purchasable || profile.transferable || isFaucetOffered;
	return balance !== undefined && balance < needed && !canBeGotInApp;
}
