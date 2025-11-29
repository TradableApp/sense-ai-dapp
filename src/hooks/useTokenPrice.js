import { useQuery } from '@tanstack/react-query';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS, LOCAL_CHAIN_ID } from '@/config/contracts';

const ASSET_PLATFORM = 'base';

export default function useTokenPrice() {
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const contractConfig = CONTRACTS[chainId];
	const tokenAddress = contractConfig?.token?.address;

	const isLocalnet = chainId === LOCAL_CHAIN_ID;

	return useQuery({
		queryKey: ['tokenPrice', 'able', chainId],
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
		enabled: !!tokenAddress && !isLocalnet,
		staleTime: 60 * 1000,
		refetchInterval: 60 * 1000,
	});
}
