import { useQuery } from '@tanstack/react-query';

import { getFaucetConfig } from '@/lib/faucetService';
import type { FaucetConfig } from '@/lib/types';

/**
 * Live faucet config (amount + rate limit) from Firestore general/sense_ai. Used
 * to label the faucet button with the amount that will actually be dispensed,
 * which is adjustable server-side without a dApp redeploy.
 */
export default function useFaucetConfig() {
	return useQuery<FaucetConfig>({
		queryKey: ['faucetConfig'],
		queryFn: getFaucetConfig,
		staleTime: 5 * 60 * 1000,
	});
}
