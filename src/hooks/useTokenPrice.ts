import { useQuery } from '@tanstack/react-query';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS, LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { FEE_TOKEN, type FeeTokenProfile } from '@/config/feeToken';

const ASSET_PLATFORM = 'base';

/**
 * Whether a market price may be asked for. Never for a token that has no market value,
 * whatever the chain; for one that has, only on mainnet, where a price exists.
 */
export function shouldFetchMarketPrice(
	profile: FeeTokenProfile,
	chainId: number | undefined,
	tokenAddress: string | undefined,
): boolean {
	if (!profile.showsMarketValue) return false;
	if (!chainId || !tokenAddress) return false;
	return chainId !== LOCAL_CHAIN_ID && chainId !== TESTNET_CHAIN_ID;
}

export default function useTokenPrice(profile: FeeTokenProfile = FEE_TOKEN) {
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const contractConfig = chainId ? CONTRACTS[chainId] : undefined;
	const tokenAddress = contractConfig?.token?.address;

	return useQuery({
		queryKey: ['tokenPrice', profile.symbol, chainId],
		queryFn: async () => {
			if (!tokenAddress) throw new Error('Token address not configured for this chain.');
			const url = `https://api.coingecko.com/api/v3/simple/token_price/${ASSET_PLATFORM}?contract_addresses=${tokenAddress}&vs_currencies=usd`;
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error('Failed to fetch price from CoinGecko API.');
			}
			const data = await response.json();
			const price = data[tokenAddress.toLowerCase()]?.usd;
			if (price === undefined) {
				throw new Error('Price not found for token in API response.');
			}
			return price;
		},
		enabled: shouldFetchMarketPrice(profile, chainId, tokenAddress),
		staleTime: 60 * 1000,
		refetchInterval: 60 * 1000,
	});
}
