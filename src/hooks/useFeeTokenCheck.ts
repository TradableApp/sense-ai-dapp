import * as Sentry from '@sentry/react';
import { useQuery } from '@tanstack/react-query';
import { getContract, readContract } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import {
	type FeeTokenReader,
	type FeeTokenVerdict,
	readFeeTokenVerdict,
} from '@/lib/feeTokenCheck';

/** `unknown`: the check has not answered, or could not. Payments are not stopped for it. */
export type FeeTokenCheckState = FeeTokenVerdict | 'unknown';

type AbiItem = { name?: string; type?: string };

function contractReader(
	contract: ReturnType<typeof getContract>,
	abi: readonly AbiItem[],
): (_method: string, _params?: readonly [string]) => Promise<unknown> {
	return (method, params) => {
		const item = abi.find(entry => entry.type === 'function' && entry.name === method);
		if (!item) throw new Error(`Fee token check: the ABI has no ${method}().`);
		return readContract({
			contract,
			method: item,
			params: params ?? [],
		} as unknown as Parameters<typeof readContract>[0]);
	};
}

/**
 * Whether the chain agrees with the token this build is for. `isBlocked` is true only for a
 * confirmed disagreement: while the reads are in flight, or when they fail, sending stays
 * possible and the failure is reported, because an unreachable node is not a wrong token.
 */
export default function useFeeTokenCheck(): { verdict: FeeTokenCheckState; isBlocked: boolean } {
	const activeWallet = useActiveWallet();
	const chain = activeWallet?.getChain();
	const contracts = chain ? CONTRACTS[chain.id] : undefined;
	const escrowAddress: string | undefined = contracts?.escrow?.address;
	const tokenAddress: string | undefined = contracts?.token?.address;
	const escrowAbi = contracts?.escrow?.abi as readonly AbiItem[] | undefined;
	const tokenAbi = contracts?.token?.abi as readonly AbiItem[] | undefined;

	const { data } = useQuery({
		queryKey: ['feeTokenCheck', chain?.id, escrowAddress, tokenAddress, FEE_TOKEN.symbol],
		queryFn: async (): Promise<FeeTokenCheckState> => {
			if (!chain || !escrowAddress || !tokenAddress || !escrowAbi || !tokenAbi) return 'unknown';
			const escrow = getContract({ client, chain, address: escrowAddress });
			const token = getContract({ client, chain, address: tokenAddress });
			const reader: FeeTokenReader = {
				escrow: contractReader(escrow, escrowAbi),
				token: contractReader(token, tokenAbi),
			};
			try {
				return await readFeeTokenVerdict({
					reader,
					configuredToken: tokenAddress,
					escrowAddress,
					profile: FEE_TOKEN,
				});
			} catch (error) {
				Sentry.captureException(error, { tags: { check: 'fee-token' } });
				return 'unknown';
			}
		},
		enabled: !!chain && !!escrowAddress && !!tokenAddress,
		// An owner can list or unlist the escrow at any time, so the answer is not kept for
		// long: asked again every five minutes.
		staleTime: 5 * 60 * 1000,
		refetchInterval: 5 * 60 * 1000,
	});

	const verdict: FeeTokenCheckState = data ?? 'unknown';
	return { verdict, isBlocked: verdict !== 'ok' && verdict !== 'unknown' };
}
