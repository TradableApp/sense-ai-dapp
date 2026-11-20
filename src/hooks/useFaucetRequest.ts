import * as Sentry from '@sentry/react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Chain } from 'thirdweb';
import { useActiveWallet } from 'thirdweb/react';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';

import { CONTRACTS, LOCAL_CHAIN_ID } from '@/config/contracts';
import { FEE_TOKEN } from '@/config/feeToken';
import { client } from '@/config/thirdweb';
import useFaucetConfig from '@/hooks/useFaucetConfig';
import { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import {
	type FaucetExpectation,
	faucetNotice,
	faucetOutcome,
	type FaucetOutcome,
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

// A successful receipt that brought the user nothing means the faucet is sending another
// token, or none: a setup fault, not the user's. Reported once per page load.
let hasReportedNoTransfer = false;
// A build with no fee token for the wallet's chain cannot read what the faucet sent: a
// setup fault of the build. Reported once per page load too.
let hasReportedNoToken = false;

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetFaucetReports(): void {
	hasReportedNoTransfer = false;
	hasReportedNoToken = false;
}

function reportNoToken(chainId: number): void {
	if (hasReportedNoToken) return;
	hasReportedNoToken = true;
	Sentry.captureException(new Error('Faucet: no fee token is configured for this chain.'), {
		tags: { check: 'faucet', chainId: String(chainId), feeToken: FEE_TOKEN.symbol },
		fingerprint: ['faucet-no-token'],
	});
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
async function waitForFaucet(chain: Chain, txHash: string, expected: FaucetExpectation) {
	const rpcRequest = getRpcClient({ client, chain });
	const receipt = await awaitFaucetReceipt(
		() => eth_getTransactionReceipt(rpcRequest, { hash: txHash as `0x${string}` }),
		{ wait: () => wait(FAUCET_POLL_MS), maxAttempts: FAUCET_WAIT_ATTEMPTS },
	);
	const outcome = faucetOutcome(receipt, expected);
	if (outcome.kind === 'no-transfer') reportNoTransfer(chain.id, txHash);
	return outcome;
}

/** Waits for the transfer, says what came of it, and refreshes the balance. */
async function settle(
	queryClient: QueryClient,
	chain: Chain,
	txHash: string,
	expected: FaucetExpectation,
): Promise<void> {
	const sentToastId = announceSent(txHash, chain.id === LOCAL_CHAIN_ID);
	let outcome: FaucetOutcome;
	// The try holds only the wait, so the sent notice comes down on both of its ends, and
	// before whatever notice follows.
	try {
		outcome = await waitForFaucet(chain, txHash, expected);
	} catch (error) {
		// Reading the receipt failed outright (no RPC client, or an error the wait does not
		// retry): the transfer was sent, but whether it arrived is not known.
		toast.dismiss(sentToastId);
		console.error('Error waiting for faucet receipt:', error);
		toast.error('Transfer Not Confirmed', {
			description: 'The transfer could not be confirmed. Check your balance in a moment.',
		});
		return;
	}
	toast.dismiss(sentToastId);
	showNotice(outcome);
	// Only tokens that arrived, or may still arrive, change the balance.
	if (outcome.kind !== 'received' && outcome.kind !== 'timeout') return;
	const queryKey = getTokenBalanceQueryKey(chain.id, expected.recipient, expected.token);
	// Forces a refetch even where the balance is not on screen or still counts as fresh.
	await queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
}

/**
 * Asks the faucet, with a loading notice. Gives the transaction hash, or null when nothing
 * was sent. The service never throws: a failure comes back as `{ success: false }` with its
 * notice shown in the loading notice's place (it is given the id), so the two are never up
 * together and the loading notice is left to it; only a send takes the loading notice down.
 */
async function askFaucet(
	recipient: string,
	amount: number,
	isLocalnet: boolean,
): Promise<string | null> {
	const loadingToastId = toast.loading(
		isLocalnet ? 'Requesting Localnet Tokens...' : 'Requesting Testnet Tokens...',
	);
	const { success, txHash } = await requestTestTokens(recipient, amount, loadingToastId);
	if (success) toast.dismiss(loadingToastId);
	return success && txHash ? txHash : null;
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

	const requestTokens = async () => {
		// The chain is read once, here: the wallet may have moved since the render.
		const chain = activeWallet?.getChain();
		if (!activeWallet || !chain) return;
		const token = CONTRACTS[chain.id]?.token?.address;
		if (!token) {
			reportNoToken(chain.id);
			toast.error('Faucet Not Available', {
				description:
					'This app is not set up for test tokens on this network. Please contact support.',
			});
			return;
		}
		const recipient = activeWallet.getAccount()?.address ?? '';
		const txHash = await askFaucet(recipient, faucetAmount, chain.id === LOCAL_CHAIN_ID);
		if (!txHash) return;
		await settle(queryClient, chain, txHash, { token, recipient, decimals: FEE_TOKEN.decimals });
	};

	// The offer stays up until closed; it is taken down before its own request starts.
	const requestTokensFromOffer = () => {
		toast.dismiss(FAUCET_OFFER_TOAST_ID);
		return requestTokens();
	};

	return { requestTokens, requestTokensFromOffer, faucetAmount };
}
