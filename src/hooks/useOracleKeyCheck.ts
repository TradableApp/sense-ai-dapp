import * as Sentry from '@sentry/react';
import { useQuery } from '@tanstack/react-query';
import { getContract, readContract } from 'thirdweb';
import { useActiveWalletChain } from 'thirdweb/react';

import { CONTRACTS } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import { describeFailure } from '@/lib/feeTokenCheckFailure';
import {
	AGENT_ORACLE_KEY_GETTER,
	type OracleKeyCheckState,
	type OracleKeyVerdict,
	readOracleKeyVerdict,
} from '@/lib/oracleKeyCheck';

type AbiItem = { name?: string; type?: string };

/**
 * How often the key is asked for again. The oracle can publish a new key, and removing its
 * role withdraws the key, at any time, so the answer is not kept for long.
 */
export const ORACLE_KEY_RECHECK_MS = 5 * 60 * 1000;

const ORACLE_KEY_CHECK_KEY = 'oracleKeyCheck';

/** The verdicts reported: each one switches paid actions off. */
const REPORTED_VERDICTS: ReadonlySet<OracleKeyVerdict> = new Set(['mismatch', 'no-key']);

// Each kind is reported once per chain per page load, so an unreachable node or a verdict
// that holds for hours cannot fill the error tracker.
const reported = new Set<string>();

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetReportedOracleKeyChecks(): void {
	reported.clear();
}

function reportOnce(key: string, report: () => void): void {
	if (reported.has(key)) return;
	reported.add(key);
	report();
}

/** A failed read, by its kind only: never the error, its message, a key or a URL. */
function reportFailure(error: unknown, chainId: number): void {
	const { kind } = describeFailure(error);
	reportOnce(`${chainId}:failure:${kind}`, () => {
		const failure = new Error(kind);
		failure.name = 'OracleKeyCheckFailure';
		Sentry.captureException(failure, {
			tags: { check: 'oracle-key', failure: kind, chainId: String(chainId) },
			fingerprint: ['oracle-key-check', 'failure', kind],
		});
	});
}

/** A verdict that switches paid actions off, by its name only: never either key. */
function reportVerdict(verdict: OracleKeyVerdict, chainId: number): void {
	if (!REPORTED_VERDICTS.has(verdict)) return;
	reportOnce(`${chainId}:verdict:${verdict}`, () => {
		const report = new Error(verdict);
		report.name = 'OracleKeyCheckVerdict';
		Sentry.captureException(report, {
			tags: { check: 'oracle-key', verdict, chainId: String(chainId) },
			fingerprint: ['oracle-key-check', 'verdict', verdict],
		});
	});
}

/**
 * Whether the key this build encrypts to is the one the agent publishes, read from the
 * chain with an `eth_call` (never from the subgraph). Something is switched off only for an
 * answer: before the first one, or when the first read fails, the state is `unknown` and
 * nothing is stopped. A failed read is rethrown so the query retries it and keeps the last
 * answer it had. Read only by the payment gate (`usePaymentGate`).
 */
export default function useOracleKeyCheck(): OracleKeyCheckState {
	const chain = useActiveWalletChain();
	const agent = chain ? CONTRACTS[chain.id]?.agent : undefined;
	const agentAddress: string | undefined = agent?.address;
	const agentAbi = agent?.abi as readonly AbiItem[] | undefined;
	const isConfigured = !!chain && !!agentAddress && !!agentAbi;

	const { data } = useQuery({
		queryKey: [ORACLE_KEY_CHECK_KEY, chain?.id, agentAddress],
		queryFn: async (): Promise<OracleKeyVerdict> => {
			if (!chain || !agentAddress || !agentAbi) {
				throw new Error('Oracle key check: no agent for this chain.');
			}
			try {
				// Inside the try, so an ABI that cannot be searched is reported like any other failure.
				const getter = agentAbi.find(
					item => item.type === 'function' && item.name === AGENT_ORACLE_KEY_GETTER,
				);
				if (!getter)
					throw new Error(`Oracle key check: the ABI has no ${AGENT_ORACLE_KEY_GETTER}().`);
				const contract = getContract({ client, chain, address: agentAddress });
				const verdict = await readOracleKeyVerdict({
					read: () =>
						readContract({ contract, method: getter, params: [] } as unknown as Parameters<
							typeof readContract
						>[0]),
					buildKey: import.meta.env.VITE_ORACLE_PUBLIC_KEY,
					chainId: chain.id,
				});
				reportVerdict(verdict, chain.id);
				return verdict;
			} catch (error) {
				reportFailure(error, chain.id);
				throw error;
			}
		},
		enabled: isConfigured,
		staleTime: ORACLE_KEY_RECHECK_MS,
		refetchInterval: ORACLE_KEY_RECHECK_MS,
	});

	return data ?? 'unknown';
}
