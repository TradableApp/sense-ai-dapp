import * as Sentry from '@sentry/react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useActiveWallet } from 'thirdweb/react';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';

import { CONTRACTS, LOCAL_CHAIN_ID } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import useFaucetConfig from '@/hooks/useFaucetConfig';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import {
	faucetNotice,
	faucetOutcome,
	type FaucetOutcome,
	type FaucetReceipt,
} from '@/lib/faucetOutcome';
import requestTestTokens, {
	awaitFaucetReceipt,
	DEFAULT_FAUCET_AMOUNT,
	FAUCET_POLL_MS,
	FAUCET_WAIT_ATTEMPTS,
	FAUCET_WAIT_MS,
} from '@/lib/faucetService';
import { wait } from '@/lib/utils';

/**
 * The id of the toast that offers the faucet (an insufficient balance). A request from it
 * closes that toast by this id and nothing else: closing every toast would also withdraw
 * the update prompt, which reads a dismissal it did not cause as the user declining.
 */
export const FAUCET_OFFER_TOAST_ID = 'faucet-offer';

type Wallet = NonNullable<ReturnType<typeof useActiveWallet>>;

// A successful receipt that brought the user nothing means the faucet is sending another
// token, or none: a setup fault, not the user's. Reported once per page load.
let hasReportedNoTransfer = false;

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetFaucetReports(): void {
	hasReportedNoTransfer = false;
}

function reportNoTransfer(chainId: number, txHash: string): void {
	if (hasReportedNoTransfer) return;
	hasReportedNoTransfer = true;
	Sentry.captureException(
		new Error('Faucet: a successful receipt carried no fee token to the user.'),
		{
			tags: { check: 'faucet', chainId: String(chainId), feeToken: FEE_TOKEN.symbol },
			extra: { txHash },
			fingerprint: ['faucet-no-transfer'],
		},
	);
}

function showNotice(outcome: FaucetOutcome): void {
	const { tone, title, description } = faucetNotice(outcome, FEE_TOKEN.symbol);
	toast[tone](title, { description });
}

/** The "sent" notice, with an explorer link where the chain has an explorer. */
function announceSent(txHash: string, isLocalnet: boolean): string | number {
	return toast.info('Tokens Sent', {
		description: 'Waiting for network confirmation...',
		// Localnet (Hardhat) has no block explorer; only offer the link on testnet.
		...(isLocalnet
			? {}
			: {
					action: {
						label: 'View on Explorer',
						onClick: () => window.open(`https://sepolia.basescan.org/tx/${txHash}`, '_blank'),
					},
			  }),
		duration: FAUCET_WAIT_MS,
	});
}

/** Waits for the faucet transaction and reads what it brought the user. */
async function waitForFaucet(wallet: Wallet, txHash: string, recipient: string) {
	const chain = wallet.getChain();
	if (!chain) throw new Error('Chain not found');
	const rpcRequest = getRpcClient({ client, chain });
	const receipt = await awaitFaucetReceipt(
		() => eth_getTransactionReceipt(rpcRequest, { hash: txHash as `0x${string}` }),
		{ wait: () => wait(FAUCET_POLL_MS), maxAttempts: FAUCET_WAIT_ATTEMPTS },
	);
	const outcome = faucetOutcome(receipt as FaucetReceipt | 'timeout', {
		token: CONTRACTS[chain.id]?.token?.address ?? '',
		recipient,
		decimals: FEE_TOKEN.decimals,
	});
	if (outcome.kind === 'no-transfer') reportNoTransfer(chain.id, txHash);
	return outcome;
}

/**
 * Asks the faucet for test tokens and says what came of it. The one handler for every
 * place that offers the faucet: tokens are announced only when the receipt shows the fee
 * token arriving in the user's wallet (`faucetOutcome`), with the amount from that log.
 */
export default function useFaucetRequest(): {
	requestTokens: () => Promise<void>;
	requestTokensFromOffer: () => Promise<void>;
	faucetAmount: number;
} {
	const activeWallet = useActiveWallet();
	const queryClient = useQueryClient();
	const { data: faucetConfig } = useFaucetConfig();
	const faucetAmount = faucetConfig?.amount ?? DEFAULT_FAUCET_AMOUNT;
	const chainId = activeWallet?.getChain()?.id;
	const isLocalnet = chainId === LOCAL_CHAIN_ID;

	const requestTokens = async () => {
		const loadingToastId = toast.loading(
			isLocalnet ? 'Requesting Localnet Tokens...' : 'Requesting Testnet Tokens...',
		);
		const address = activeWallet?.getAccount()?.address ?? '';
		const { success, txHash } = await requestTestTokens(address, faucetAmount);
		toast.dismiss(loadingToastId);
		if (!success || !txHash || !activeWallet) return;

		const sentToastId = announceSent(txHash, isLocalnet);
		try {
			const outcome = await waitForFaucet(activeWallet, txHash, address);
			toast.dismiss(sentToastId);
			showNotice(outcome);
			if (outcome.kind === 'reverted') return;
			const queryKey = getTokenBalanceQueryKey(
				chainId ?? 0,
				address,
				CONTRACTS[chainId ?? 0]?.token?.address,
			);
			// Forces a refetch even where the balance is not on screen or still counts as fresh.
			await queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
		} catch (error) {
			// The wait never started, so nothing above took the "Tokens Sent" notice down.
			toast.dismiss(sentToastId);
			console.error('Error waiting for faucet receipt:', error);
		}
	};

	// The offer stays up until closed; it is taken down before its own request starts.
	const requestTokensFromOffer = () => {
		toast.dismiss(FAUCET_OFFER_TOAST_ID);
		return requestTokens();
	};

	return { requestTokens, requestTokensFromOffer, faucetAmount };
}
