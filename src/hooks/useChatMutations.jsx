import { useMutation, useQueryClient } from '@tanstack/react-query';
import ethCrypto from 'eth-crypto';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { getContract, prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { useActiveAccount, useActiveWallet } from 'thirdweb/react';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';

import { Button } from '@/components/ui/button';
import { CONTRACTS, TESTNET_CHAIN_ID } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import { encryptData } from '@/lib/crypto';
import requestTestTokens from '@/lib/faucetService';
import { wait } from '@/lib/utils';

import { getTokenBalanceQueryKey } from './useTokenBalance';

/**
 * A helper to remove the '0x' and '04' prefixes from an uncompressed public key,
 * preparing it for use with the eth-crypto library.
 * @param {string} publicKey - The public key string.
 * @returns {string} The cleaned, raw public key.
 */
function cleanPublicKey(publicKey) {
	if (publicKey.startsWith('0x04')) {
		return publicKey.slice(4);
	}
	if (publicKey.startsWith('04')) {
		return publicKey.slice(2);
	}
	return publicKey;
}

/**
 * Creates the encrypted payloads required by the smart contract.
 * This is a core utility for all mutations that send data to the TEE.
 * @param {CryptoKey} sessionKey The user's extractable session key.
 * @param {object} payload The plaintext JavaScript object to encrypt for the TEE.
 * @returns {Promise<{encryptedPayload: string, roflEncryptedKey: string}>}
 */
async function createEncryptedPayloads(sessionKey, payload) {
	// 1. Symmetrically encrypt the main payload for the TEE using the user's session key.
	const encryptedPayloadString = await encryptData(sessionKey, payload);
	const encryptedPayloadBytes = ethers.toUtf8Bytes(encryptedPayloadString);

	// 2. Convert the Uint8Array to a hex string
	const encryptedPayload = ethers.hexlify(encryptedPayloadBytes);

	// 3. Export the raw session key material from the CryptoKey object.
	const rawSessionKey = await window.crypto.subtle.exportKey('raw', sessionKey);

	// 4. Asymmetrically encrypt the raw session key for the TEE oracle using its public key.
	const oraclePublicKey = import.meta.env.VITE_ORACLE_PUBLIC_KEY;

	if (!oraclePublicKey) {
		throw new Error('VITE_ORACLE_PUBLIC_KEY is not set in .env');
	}

	const encryptedKeyForOracle = await ethCrypto.encryptWithPublicKey(
		cleanPublicKey(oraclePublicKey),
		Buffer.from(rawSessionKey).toString('hex'),
	);
	const roflEncryptedKeyString = ethCrypto.cipher.stringify(encryptedKeyForOracle);
	const roflEncryptedKeyBytes = ethers.toUtf8Bytes(roflEncryptedKeyString);

	// Convert the Uint8Array to a hex string
	const roflEncryptedKey = ethers.hexlify(roflEncryptedKeyBytes);

	return { encryptedPayload, roflEncryptedKey };
}

/**
 * A centralized hook for managing all "write" transactions for chat and history.
 * It returns a collection of pre-configured `useMutation` hooks that components can use.
 */
export default function useChatMutations() {
	const activeAccount = useActiveAccount();
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const isTestnet = chainId === TESTNET_CHAIN_ID;
	const queryClient = useQueryClient();

	const handleFaucetRequest = async () => {
		toast.dismiss();

		const loadingToastId = toast.loading('Requesting Testnet Tokens...');

		const address = activeWallet?.getAccount()?.address;
		const { success, txHash } = await requestTestTokens(address);
		console.log('success', success, 'txHash', txHash);

		toast.dismiss(loadingToastId);

		if (success && txHash) {
			// 1. Show initial Toast with Explorer Link
			const sentToastId = toast.info('Tokens Sent', {
				description: 'Waiting for network confirmation...',
				action: {
					label: 'View on Explorer',
					onClick: () => window.open(`https://sepolia.basescan.org/tx/${txHash}`, '_blank'),
				},
				duration: 10000,
			});

			// 2. Poll for confirmation using Thirdweb RPC
			try {
				// Get the RPC client for the current chain
				const rpcRequest = getRpcClient({ client, chain: activeWallet.getChain() });

				let attempts = 0;
				const maxAttempts = 30; // Try for ~60 seconds (2s interval)
				while (attempts < maxAttempts) {
					try {
						// Check if receipt exists
						// eslint-disable-next-line no-await-in-loop
						const receipt = await eth_getTransactionReceipt(rpcRequest, { hash: txHash });
						console.log('receipt', receipt);

						if (receipt) {
							toast.dismiss(sentToastId); // Dismiss the "Tokens Sent" info toast
							toast.success('Tokens Received', {
								description: '100 ABLE tokens have been added to your wallet.',
							});

							// Refresh balance
							const queryKey = getTokenBalanceQueryKey(
								chainId,
								address,
								CONTRACTS[chainId]?.token?.address,
							);
							// eslint-disable-next-line no-await-in-loop
							await queryClient.invalidateQueries({ queryKey });

							break;
						}
					} catch (e) {
						// Receipt not found yet, ignore
					}

					// eslint-disable-next-line no-await-in-loop
					await wait(2000);
					attempts += 1;
				}
			} catch (error) {
				console.error('Error waiting for faucet receipt:', error);
			}
		}
	};

	// We invalidate 'usagePlan' (Allowance, Pending Count) and 'tokenBalance' (Wallet funds)
	// immediately after a transaction confirms, as these live on-chain and update instantly.
	// Graph data ('conversations', 'messages', 'stuckRequests') is handled by useLiveResponse.jsx
	const genericOnSuccess = (queryKeysToInvalidate = []) => {
		queryClient.invalidateQueries({ queryKey: ['usagePlan'] });
		queryClient.invalidateQueries({ queryKey: ['tokenBalance'] });

		queryKeysToInvalidate.forEach(key => {
			queryClient.invalidateQueries({ queryKey: [key] });
		});
	};

	// A centralized onError handler that decodes specific contract errors.
	const genericOnError = (error, action) => {
		console.error(`Failed to ${action}:`, error);
		const errorMessage = error?.message || '';

		// Create Interfaces for decoding
		const tokenInterface = new ethers.Interface(AbleTokenABI.abi);
		const agentInterface = new ethers.Interface(EVMAIAgentABI.abi);
		const escrowInterface = new ethers.Interface(EVMAIAgentEscrowABI.abi);

		// Helper to check error against a specific interface
		const isError = (iface, name) => {
			const fragment = iface.getError(name);
			return fragment && (errorMessage.includes(fragment.selector) || errorMessage.includes(name));
		};

		// --- Token Errors ---
		if (isError(tokenInterface, 'ERC20InsufficientBalance')) {
			toast.error('Insufficient ABLE Balance', {
				description: (
					<div className="flex flex-col gap-3 mt-1">
						<p>You need more ABLE tokens to pay for this action.</p>
						{isTestnet && (
							<Button
								size="sm"
								variant="outline"
								className="w-full border-primary/20 bg-primary/10 hover:bg-primary/20 text-primary"
								onClick={handleFaucetRequest}
							>
								Get 100 Testnet ABLE
							</Button>
						)}
					</div>
				),
				// Persist on testnet so they see the button, otherwise use sonner toast default 4s
				duration: isTestnet ? Infinity : 4000,
			});
			return;
		}

		if (isError(tokenInterface, 'ERC20InsufficientAllowance')) {
			toast.error('Spending Limit Reached', {
				description:
					'The contract is not authorized to spend your tokens. Please increase your limit.',
			});
			return;
		}

		// --- Escrow Errors (EVMAIAgentEscrow.sol) ---
		if (isError(escrowInterface, 'NoActiveSpendingLimit')) {
			toast.error('No Active Plan', {
				description: 'You must set a spending limit before starting a conversation.',
			});
			return;
		}
		if (isError(escrowInterface, 'SpendingLimitExpired')) {
			toast.error('Plan Expired', {
				description: 'Your spending limit has expired. Please renew it in the dashboard.',
			});
			return;
		}
		if (isError(escrowInterface, 'InsufficientSpendingLimitAllowance')) {
			toast.error('Limit Reached', {
				description: 'You have used up your spending limit for this period.',
			});
			return;
		}
		if (isError(escrowInterface, 'HasPendingPrompts')) {
			toast.error('Pending Action', {
				description: 'You cannot change your plan while a prompt is still processing.',
			});
			return;
		}
		if (isError(escrowInterface, 'PromptNotCancellableYet')) {
			toast.error('Too Soon to Cancel', {
				description: 'Please wait a few seconds before cancelling the prompt.',
			});
			return;
		}
		if (isError(escrowInterface, 'PromptNotRefundableYet')) {
			toast.error('Too Soon to Refund', {
				description: 'You must wait 1 hour after the request was created before refunding.',
			});
			return;
		}
		if (isError(escrowInterface, 'NotPromptOwner')) {
			toast.error('Access Denied', {
				description: 'You are not the owner of this prompt.',
			});
			return;
		}
		if (isError(escrowInterface, 'EscrowNotPending')) {
			toast.error('Action Invalid', {
				description: 'This request has already been completed, cancelled, or refunded.',
			});
			return;
		}
		if (isError(escrowInterface, 'EscrowNotFound')) {
			toast.error('Request Not Found', {
				description: 'The payment record for this request could not be found.',
			});
			return;
		}

		// --- Agent Errors (EVMAIAgent.sol) ---
		if (isError(agentInterface, 'RegenerationAlreadyPending')) {
			toast.error('Regeneration in Progress', {
				description:
					'A regeneration for this message is already pending. Please wait or cancel it.',
			});
			return;
		}
		if (isError(agentInterface, 'JobAlreadyFinalized')) {
			toast.error('Request Already Finalized', {
				description:
					'This prompt has already been answered or cancelled. Please refresh your page.',
			});
			return;
		}
		if (isError(agentInterface, 'Unauthorized')) {
			toast.error('Access Denied', {
				description: 'You do not have permission to modify this conversation.',
			});
			return;
		}
		if (isError(agentInterface, 'InvalidPromptMessageId')) {
			toast.error('Invalid Message', {
				description: 'The prompt you are trying to reply to does not exist.',
			});
			return;
		}

		// --- Generic Fallback ---
		// Handle user rejection specifically
		if (errorMessage.includes('User rejected') || errorMessage.includes('User denied')) {
			toast.warning('Transaction Cancelled', {
				description: 'You rejected the request in your wallet. Please try again.',
			});
			return;
		}

		toast.error(`Failed to ${action}`, {
			description: 'An unexpected error occurred. Check console for details.',
		});
	};

	// --- MUTATIONS ---

	/**
	 * Represents the mutation for both creating a new conversation and sending a follow-up prompt.
	 * It calls the `initiatePrompt` function on the smart contract.
	 * Upon success, it parses the transaction receipt to find and return the real, on-chain IDs.
	 */
	const initiatePromptMutation = useMutation({
		mutationFn: async ({ conversationId, promptText, sessionKey, parentId, parentCID }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}
			console.log(
				'conversationId',
				conversationId,
				'promptText',
				promptText,
				'sessionKey',
				sessionKey,
				'parentId',
				parentId,
				'parentCID',
				parentCID,
			);

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				promptText,
				isNewConversation: !conversationId,
				previousMessageId: parentId || null,
				previousMessageCID: parentCID || null,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiatePrompt',
				params: [conversationId || 0, encryptedPayload, roflEncryptedKey],
			});
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);

			const agentInterface = new ethers.Interface(contractConfig.agent.abi);
			const promptSubmittedTopic = agentInterface.getEvent('PromptSubmitted').topicHash;
			const log = transactionReceipt.logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === promptSubmittedTopic,
			);

			if (!log) throw new Error('PromptSubmitted event log not found in transaction receipt.');
			const parsedLog = agentInterface.parseLog({ topics: log.topics, data: log.data });

			return {
				conversationId: parsedLog.args.conversationId.toString(),
				promptMessageId: parsedLog.args.promptMessageId.toString(),
				answerMessageId: parsedLog.args.answerMessageId.toString(),
			};
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'send message'),
	});

	/**
	 * Represents the mutation for regenerating an AI response.
	 * It calls the `initiateRegeneration` function on the smart contract.
	 */
	const regenerateMutation = useMutation({
		mutationFn: async ({
			conversationId,
			promptMessageId,
			originalAnswerMessageId,
			instructions,
			sessionKey,
			promptMessageCID,
			originalAnswerMessageCID,
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				instructions,
				promptMessageCID,
				originalAnswerMessageCID,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateRegeneration',
				params: [
					conversationId,
					promptMessageId,
					originalAnswerMessageId,
					encryptedPayload,
					roflEncryptedKey,
				],
			});
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);

			const agentInterface = new ethers.Interface(contractConfig.agent.abi);
			const eventTopic = agentInterface.getEvent('RegenerationRequested').topicHash;
			const log = transactionReceipt.logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === eventTopic,
			);
			if (!log) throw new Error('RegenerationRequested event log not found.');
			const parsedLog = agentInterface.parseLog({ topics: log.topics, data: log.data });
			return { newAnswerMessageId: parsedLog.args.answerMessageId.toString() };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'regenerate response'),
	});

	/**
	 * Represents the mutation for branching a conversation.
	 * It calls the `initiateBranch` function on the smart contract.
	 */
	const branchConversationMutation = useMutation({
		mutationFn: async ({
			originalConversationId,
			branchPointMessageId,
			originalTitle,
			sessionKey,
		}) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				originalTitle,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateBranch',
				params: [originalConversationId, branchPointMessageId, encryptedPayload, roflEncryptedKey],
			});
			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);

			const agentInterface = new ethers.Interface(contractConfig.agent.abi);
			const eventTopic = agentInterface.getEvent('BranchRequested').topicHash;
			const log = transactionReceipt.logs.find(
				l =>
					l.address.toLowerCase() === contractConfig.agent.address.toLowerCase() &&
					l.topics[0] === eventTopic,
			);
			if (!log) throw new Error('BranchRequested event log not found.');
			const parsedLog = agentInterface.parseLog({ topics: log.topics, data: log.data });
			return { newConversationId: parsedLog.args.newConversationId.toString() };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'branch conversation'),
	});

	/**
	 * Represents the mutation for updating metadata (renaming or deleting).
	 * It calls the `initiateMetadataUpdate` function on the smart contract.
	 */
	const metadataUpdateMutation = useMutation({
		mutationFn: async ({ conversationId, title, isDeleted, sessionKey }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain || !sessionKey || !activeAccount) {
				throw new Error('Wallet not connected or session not ready.');
			}

			const contractConfig = CONTRACTS[chain.id];

			if (!contractConfig?.escrow) {
				throw new Error('Contracts not configured for this chain.');
			}

			const { encryptedPayload, roflEncryptedKey } = await createEncryptedPayloads(sessionKey, {
				title,
				isDeleted,
			});

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'initiateMetadataUpdate',
				params: [conversationId, encryptedPayload, roflEncryptedKey],
			});

			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);

			return { conversationId };
		},
		onSuccess: () => {
			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'update conversation'),
	});

	/**
	 * Represents the mutation for cancelling a pending prompt.
	 * It calls the `cancelPrompt` function on the smart contract.
	 * Useful if the Oracle is down or taking too long.
	 */
	const cancelPromptMutation = useMutation({
		mutationFn: async ({ answerMessageId }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain) throw new Error('Wallet not connected');

			const contractConfig = CONTRACTS[chain.id];
			if (!contractConfig?.escrow) throw new Error('Contracts not configured for this chain.');

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});

			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'cancelPrompt',
				params: [answerMessageId],
			});

			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);
		},
		onSuccess: () => {
			toast.success('Prompt Cancelled', {
				description: 'The prompt has been cancelled and tokens refunded.',
			});

			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'cancel prompt'),
	});

	/**
	 * Represents the mutation for processing a refund for a stuck prompt (older than 1 hour).
	 * It calls the `processRefund` function on the smart contract.
	 */
	const processRefundMutation = useMutation({
		mutationFn: async ({ answerMessageId }) => {
			const chain = activeWallet?.getChain();
			if (!activeWallet || !chain) throw new Error('Wallet not connected');

			const contractConfig = CONTRACTS[chain.id];
			if (!contractConfig?.escrow) throw new Error('Contracts not configured for this chain.');

			const escrowContract = getContract({
				client,
				chain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});

			const tx = prepareContractCall({
				contract: escrowContract,
				method: 'processRefund',
				params: [answerMessageId],
			});

			const transactionReceipt = await sendAndConfirmTransaction({
				transaction: tx,
				account: activeAccount,
			});
			console.log('transactionReceipt', transactionReceipt);
		},
		onSuccess: () => {
			toast.success('Refund Processed', {
				description: 'Your pending request count has been cleared.',
			});

			// Immediate RPC update
			genericOnSuccess();
		},
		onError: error => genericOnError(error, 'process refund'),
	});

	return {
		initiatePromptMutation,
		regenerateMutation,
		branchConversationMutation,
		metadataUpdateMutation,
		cancelPromptMutation,
		processRefundMutation,
	};
}
