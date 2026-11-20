import { AlertCircle, Info, Loader2 } from 'lucide-react';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { FEE_TOKEN, type FeeTokenProfile } from '@/config/feeToken';
import useTokenPrice from '@/hooks/useTokenPrice';

const formatUsd = (value: number) =>
	value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PriceInfoDialogProps {
	title: string;
	description: string;
}

function PriceInfoDialog({ title, description }: PriceInfoDialogProps) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Info className="mr-1 h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground" />
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction>OK</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

interface PlanValueEstimateProps {
	/** The limit being set, in whole tokens. */
	limit: number;
	chainId: number | undefined;
	profile?: FeeTokenProfile;
}

function MarketValue({ limit, chainId, profile }: Required<PlanValueEstimateProps>) {
	const { data: livePrice, isLoading, isError } = useTokenPrice(profile);
	const isLocalnet = chainId === LOCAL_CHAIN_ID;
	const isTestChain = isLocalnet || chainId === TESTNET_CHAIN_ID;

	if (isTestChain) {
		// A profile with no planned price has no estimate to show on a test chain.
		if (profile.plannedPriceUsd === undefined) return null;
		return (
			<div className="flex items-center justify-end text-sm text-muted-foreground">
				<PriceInfoDialog
					title="Test Price"
					description={`You are on a ${
						isLocalnet ? 'local' : 'test'
					} network. The USD value is an estimate based on the planned TGE price of $${
						profile.plannedPriceUsd
					}.`}
				/>
				<span>Est. Value: ≈ ${formatUsd((limit || 0) * profile.plannedPriceUsd)} USD</span>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-end text-sm text-muted-foreground">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				<span>Fetching live price...</span>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex items-center justify-end text-sm text-destructive">
				<AlertCircle className="mr-2 h-4 w-4" />
				<span>Could not fetch live price.</span>
			</div>
		);
	}

	if (livePrice === undefined) return null;

	return (
		<div className="flex items-center justify-end text-sm text-muted-foreground">
			<PriceInfoDialog
				title="Live Market Value"
				description={`The USD value is a real-time estimate based on the current market price of ${profile.symbol} and may fluctuate.`}
			/>
			<span>Current Value: ≈ ${formatUsd((limit || 0) * livePrice)} USD</span>
		</div>
	);
}

/**
 * The value in dollars of the limit being set, for a fee token that has a market value.
 * For one that has none this renders nothing and asks for no price: the price hook lives
 * in the inner component, which is never mounted.
 */
export default function PlanValueEstimate({
	limit,
	chainId,
	profile = FEE_TOKEN,
}: PlanValueEstimateProps) {
	if (!profile.showsMarketValue) return null;
	return <MarketValue limit={limit} chainId={chainId} profile={profile} />;
}
