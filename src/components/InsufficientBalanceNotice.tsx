import CommunityLinksNotice from '@/components/CommunityLinksNotice';
import { Button } from '@/components/ui/button';
import type { FeeTokenProfile } from '@/config/feeToken';
import pointsToCommunity from '@/lib/whereToGetToken';

/** The faucet's offer, made by a caller that asks the faucet through `useFaucetRequest`. */
export interface FaucetOffer {
	label: string;
	onRequest: () => Promise<void>;
}

interface InsufficientBalanceNoticeProps {
	profile: FeeTokenProfile;
	/** The faucet's button, or null where no faucet serves this chain. */
	faucetOffer: FaucetOffer | null;
}

/**
 * Whether the insufficient-balance toast offers something to click: the faucet, or the
 * community links. The balance is not known there, only that it is not enough.
 */
export function offersAWayToGetMore(profile: FeeTokenProfile, faucetOffered: boolean): boolean {
	return (
		faucetOffered || pointsToCommunity({ balance: 0, needed: 1, profile, isFaucetOffered: false })
	);
}

/** The body of the insufficient-balance toast: what is missing, and how to get more. */
export default function InsufficientBalanceNotice({
	profile,
	faucetOffer,
}: InsufficientBalanceNoticeProps) {
	const showsLinks = !faucetOffer && offersAWayToGetMore(profile, false);
	return (
		<div className="flex flex-col gap-3 mt-1">
			{showsLinks ? (
				<CommunityLinksNotice symbol={profile.symbol} hasNone={false} />
			) : (
				<p>You need more {profile.symbol} to pay for this action.</p>
			)}
			{faucetOffer && (
				<Button
					size="sm"
					variant="outline"
					className="w-full border-primary/20 bg-primary/10 hover:bg-primary/20 text-primary"
					onClick={() => {
						faucetOffer.onRequest();
					}}
				>
					{faucetOffer.label}
				</Button>
			)}
		</div>
	);
}
