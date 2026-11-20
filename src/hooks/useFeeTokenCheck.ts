import * as Sentry from '@sentry/react';
import { useQuery } from '@tanstack/react-query';
import { getContract, readContract } from 'thirdweb';
import { useActiveWalletChain } from 'thirdweb/react';
import { eth_getCode as getCodeAt, getRpcClient } from 'thirdweb/rpc';

import { CONTRACTS } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import {
	blocksAction,
	type FeeTokenCheckState,
	type FeeTokenReader,
	type FeeTokenVerdict,
	type PaidAction,
	readFeeTokenVerdict,
} from '@/lib/feeTokenCheck';
import { describeFailure, failureReport } from '@/lib/feeTokenCheckFailure';

type AbiItem = { name?: string; type?: string };

function contractReader(
	contract: ReturnType<typeof getContract>,
	abi: readonly AbiItem[],
): (_method: string, _params?: readonly [string]) => Promise<unknown> {
	// async, so an ABI without the function is a rejection like any other failed read.
	return async (method, params) => {
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
 * How often the answer is asked for again. An owner can list or unlist the escrow, or pause
 * the token, at any time, so the answer is not kept for long.
 */
export const FEE_TOKEN_RECHECK_MS = 5 * 60 * 1000;

// A failure is repeated on every retry and every later read. Each kind is reported once per
// chain per page load, so an unreachable node cannot fill the error tracker. The line is
// not part of the key: a provider that puts request ids in its errors would make every
// retry a new report.
const reported = new Set<string>();

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetReportedFailures(): void {
	reported.clear();
}

function reportOnce(error: unknown, chainId: number): void {
	// Never the original error: see feeTokenCheckFailure.ts for what it can carry.
	const failure = describeFailure(error);
	const key = `${chainId}:${failure.kind}`;
	if (reported.has(key)) return;
	reported.add(key);
	Sentry.captureException(failureReport(failure), {
		tags: {
			check: 'fee-token',
			failure: failure.kind,
			chainId: String(chainId),
			feeToken: FEE_TOKEN.symbol,
		},
		fingerprint: ['fee-token-check', failure.kind],
	});
}

export interface FeeTokenCheck {
	verdict: FeeTokenCheckState;
	/** Whether a paying action is switched off: see `blocksAction`. */
	blocks: (_action: PaidAction) => boolean;
}

/**
 * Whether the chain agrees with the token this build is for.
 *
 * Something is switched off only for a confirmed disagreement. Before the first answer, or
 * when the first read fails, the verdict is `unknown` and nothing is stopped: an unreachable
 * node is not a wrong token. A failed read is rethrown so the query retries it and keeps the
 * last answer it had, which means a block that was confirmed stays until a read passes.
 */
export default function useFeeTokenCheck(): FeeTokenCheck {
	const chain = useActiveWalletChain();
	const contracts = chain ? CONTRACTS[chain.id] : undefined;
	const escrowAddress: string | undefined = contracts?.escrow?.address;
	const tokenAddress: string | undefined = contracts?.token?.address;
	const agentAddress: string | undefined = contracts?.agent?.address;
	const escrowAbi = contracts?.escrow?.abi as readonly AbiItem[] | undefined;
	const tokenAbi = contracts?.token?.abi as readonly AbiItem[] | undefined;
	const isConfigured =
		!!chain && !!escrowAddress && !!tokenAddress && !!agentAddress && !!escrowAbi && !!tokenAbi;

	const { data } = useQuery({
		queryKey: [
			'feeTokenCheck',
			chain?.id,
			escrowAddress,
			tokenAddress,
			agentAddress,
			FEE_TOKEN.symbol,
		],
		queryFn: async (): Promise<FeeTokenVerdict> => {
			if (!chain || !escrowAddress || !tokenAddress || !agentAddress || !escrowAbi || !tokenAbi) {
				throw new Error('Fee token check: no contracts for this chain.');
			}
			const rpcRequest = getRpcClient({ client, chain });
			const reader: FeeTokenReader = {
				escrow: contractReader(getContract({ client, chain, address: escrowAddress }), escrowAbi),
				token: contractReader(getContract({ client, chain, address: tokenAddress }), tokenAbi),
				// Asked of the node each time: thirdweb's bytecode helpers keep an answer.
				code: address => getCodeAt(rpcRequest, { address: address as `0x${string}` }),
			};
			try {
				return await readFeeTokenVerdict({
					reader,
					configuredToken: tokenAddress,
					configuredAgent: agentAddress,
					escrowAddress,
					profile: FEE_TOKEN,
				});
			} catch (error) {
				reportOnce(error, chain.id);
				throw error;
			}
		},
		enabled: isConfigured,
		staleTime: FEE_TOKEN_RECHECK_MS,
		// FEE_TOKEN_RECHECK_MS, written out: the polling-cadence guard reads only a literal
		// here. The recheck tests advance the clock by the constant and fail if this is longer.
		refetchInterval: 5 * 60 * 1000,
	});

	const verdict: FeeTokenCheckState = data ?? 'unknown';
	return { verdict, blocks: action => blocksAction(verdict, action) };
}
