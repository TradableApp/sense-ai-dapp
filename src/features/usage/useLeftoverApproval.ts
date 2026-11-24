import { useQuery } from '@tanstack/react-query';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';

import { readEscrowAllowance, readLimitStands } from './escrowReads';

/**
 * Whether the wallet has a token approval left for the escrow with no plan standing: after a
 * revoke whose second step did not finish, or from before revoking removed the approval. It
 * is read from the chain, so it holds after a reload and on another device.
 *
 * The key starts with `usagePlan`, so the refresh the plan mutations make after each
 * transaction (`['usagePlan']`, every query under it) reads it again too. A failed read is
 * an error, never "nothing left", and the notice shows nothing for it.
 */
export default function useLeftoverApproval() {
	const activeWallet = useActiveWallet();
	const owner = activeWallet?.getAccount()?.address;
	const chain = activeWallet?.getChain();

	return useQuery({
		queryKey: ['usagePlan', chain?.id, owner, 'leftoverApproval'],
		queryFn: async (): Promise<boolean> => {
			const contracts = chain ? CONTRACTS[chain.id] : undefined;
			if (!chain || !owner || !contracts?.escrow || !contracts?.token) return false;
			const [isLimitStanding, allowance] = await Promise.all([
				readLimitStands(chain, contracts, owner),
				readEscrowAllowance(chain, contracts, owner),
			]);
			return !isLimitStanding && allowance > 0n;
		},
		enabled: !!chain && !!owner,
		staleTime: 60 * 1000,
		refetchOnWindowFocus: true,
	});
}
