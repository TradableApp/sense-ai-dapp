import type { FeeTokenProfile } from '@/config/feeToken';

interface WalletSituation {
	/** The wallet's fee token balance in whole tokens, or undefined while it is not known. */
	balance: number | undefined;
	profile: FeeTokenProfile;
	/** Whether the faucet is offered on the wallet's chain. */
	isFaucetOffered: boolean;
}

/**
 * Whether to point the wallet to the community links: it holds none of the fee token, and
 * the app offers no way to get some (the profile says it cannot be bought or sent, and no
 * faucet serves this chain). Decided by the profile's flags, never by which token it is.
 */
export default function pointsToCommunity({
	balance,
	profile,
	isFaucetOffered,
}: WalletSituation): boolean {
	const canBeGotInApp = profile.purchasable || profile.transferable || isFaucetOffered;
	return balance === 0 && !canBeGotInApp;
}
