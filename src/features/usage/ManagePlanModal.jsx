import { useEffect, useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ethers } from 'ethers';
import { AlertCircle, Info, Loader2, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { getContract, prepareContractCall } from 'thirdweb';
import { useActiveWallet, useSendTransaction } from 'thirdweb/react';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';
import { z } from 'zod';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import Input from '@/components/ui/input';
import Label from '@/components/ui/label';
import { CONTRACTS, LOCAL_CHAIN_ID, TESTNET_CHAIN_ID } from '@/config/contracts';
import { client } from '@/config/thirdweb';
import useChatMutations from '@/hooks/useChatMutations';
import useStuckRequests from '@/hooks/useStuckRequests';
import useTokenBalance, { getTokenBalanceQueryKey } from '@/hooks/useTokenBalance';
import useTokenPrice from '@/hooks/useTokenPrice';
import requestTestTokens from '@/lib/faucetService';
import { wait } from '@/lib/utils';

const managePlanSchema = z.object({
	limit: z
		.number({ invalid_type_error: 'Limit must be a number.' })
		.positive({ message: 'Limit must be greater than zero.' }),
	days: z
		.number({ invalid_type_error: 'Days must be a number.' })
		.int()
		.positive({ message: 'Duration must be at least one day.' }),
});

const TGE_PRICE_USD = 0.015;
const DEFAULT_USD_LIMIT = 15;
const DEFAULT_TOKEN_LIMIT = DEFAULT_USD_LIMIT / TGE_PRICE_USD;
const DEFAULT_DAYS = 365;

function PriceInfoDialog({ title, description }) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Info className="mr-1 h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground" />
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction>OK</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export default function ManagePlanModal({ open, onOpenChange, existingPlan }) {
	const activeWallet = useActiveWallet();
	const chainId = activeWallet?.getChain()?.id;
	const isLocalnet = chainId === LOCAL_CHAIN_ID;
	const isTestnet = chainId === TESTNET_CHAIN_ID;
	const { mutate: send } = useSendTransaction();
	const queryClient = useQueryClient();
	const [statusText, setStatusText] = useState('');
	const [isRequestingTokens, setIsRequestingTokens] = useState(false);
	const [isRefundingAll, setIsRefundingAll] = useState(false);

	// Hooks for Refund Functionality
	const { data: stuckRequests /* , isLoading: isLoadingStuck */ } = useStuckRequests();
	const { processRefundMutation } = useChatMutations();

	const { data: balanceData, isLoading: isLoadingBalance } = useTokenBalance(
		chainId,
		activeWallet?.getAccount()?.address,
	);
	// The raw BigInt is now in `balanceData.value`
	const formattedBalance = balanceData ? Number(balanceData.displayValue) : 0;
	console.log(
		'balanceData',
		balanceData,
		'isLoadingBalance',
		isLoadingBalance,
		'formattedBalance',
		formattedBalance,
	);

	const {
		register,
		handleSubmit,
		watch,
		reset,
		formState: { errors, isValid },
	} = useForm({
		resolver: zodResolver(managePlanSchema),
		mode: 'onChange',
		defaultValues: {
			limit: existingPlan ? existingPlan.allowance : DEFAULT_TOKEN_LIMIT,
			days: existingPlan ? 365 : DEFAULT_DAYS,
		},
	});

	useEffect(() => {
		if (open) {
			reset({
				limit: existingPlan ? existingPlan.allowance : DEFAULT_TOKEN_LIMIT,
				days: existingPlan ? 365 : DEFAULT_DAYS,
			});
		}
	}, [open, existingPlan, reset]);

	const currentLimit = watch('limit');
	const { data: livePrice, isLoading: isLoadingPrice, isError: isErrorPrice } = useTokenPrice();
	const currentPrice = isLocalnet ? TGE_PRICE_USD : livePrice;

	const usdValue = useMemo(() => {
		if (currentPrice === undefined) return null;
		return (currentLimit || 0) * currentPrice;
	}, [currentLimit, currentPrice]);
	console.log('currentLimit', currentLimit, 'currentPrice', currentPrice, 'usdValue', usdValue);

	const isExceedingBalance =
		!isLoadingBalance && balanceData !== undefined && currentLimit > formattedBalance;
	console.log('isExceedingBalance', isExceedingBalance);

	// Logic to block actions if there are pending prompts
	const hasPendingPrompts = existingPlan?.pendingEscrowCount > 0;

	const setPlanMutation = useMutation({
		mutationFn: async ({ limitInWei, expiresAtTimestamp }) => {
			console.log(
				'limitInWei',
				limitInWei,
				'expiresAtTimestamp',
				expiresAtTimestamp,
				'activeWallet',
				activeWallet,
				'chainId',
				chainId,
			);

			if (!activeWallet || !chainId) {
				throw new Error('Wallet not connected');
			}

			const contractConfig = CONTRACTS[chainId];
			console.log('contractConfig', contractConfig);

			if (!contractConfig) {
				throw new Error('Contracts not configured for this chain');
			}

			// Get the full chain object from the wallet
			const connectedChain = activeWallet.getChain();
			console.log('connectedChain', connectedChain);

			// --- DEBUG LOGGING START ---
			console.log('--- Debugging Transaction Context ---');
			console.log('Configured LOCAL_CHAIN_ID:', LOCAL_CHAIN_ID);
			console.log('Wallet Chain ID (chainId prop):', chainId);
			console.log('Wallet Object Chain (getChain()):', connectedChain);
			console.log('Wallet Address:', activeWallet.getAccount()?.address);
			console.log('Target Contract Config:', contractConfig);
			// --- DEBUG LOGGING END ---

			if (!connectedChain) {
				throw new Error('Could not determine connected chain.');
			}

			setStatusText('1/2: Approving...');
			toast.info('Step 1/2: Please approve the token spending limit in your wallet.');

			const tokenContract = getContract({
				client,
				chain: connectedChain,
				address: contractConfig.token.address,
				abi: contractConfig.token.abi,
			});
			console.log('tokenContract', tokenContract);

			const approveTx = prepareContractCall({
				contract: tokenContract,
				method: 'approve',
				params: [contractConfig.escrow.address, limitInWei],
			});
			console.log('approveTx', approveTx);

			await new Promise((resolve, reject) => {
				send(approveTx, { onSuccess: resolve, onError: reject });
			});

			setStatusText('2/2: Setting Limit...');
			toast.info('Step 2/2: Please confirm setting the new spending limit in your wallet.');

			const escrowContract = getContract({
				client,
				chain: connectedChain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			console.log('escrowContract', escrowContract);

			const setSubTx = prepareContractCall({
				contract: escrowContract,
				method: 'setSpendingLimit',
				params: [limitInWei, expiresAtTimestamp],
			});
			console.log('setSubTx', setSubTx);

			await new Promise((resolve, reject) => {
				send(setSubTx, { onSuccess: resolve, onError: reject });
			});
		},
		onSuccess: async () => {
			toast.success('Spending Limit Set!', {
				description: 'Your new plan is now active.',
			});
			// Wait 2 seconds to allow the RPC node to index the new state.
			// Without this, invalidateQueries fetches stale data instantly.
			await wait(2000);

			await queryClient.invalidateQueries({ queryKey: ['usagePlan'] });
			onOpenChange(false);
		},
		onError: error => {
			toast.error('Transaction Failed', {
				description: error.message || 'An unexpected error occurred. Please try again.',
			});
		},
	});

	const revokeMutation = useMutation({
		mutationFn: async () => {
			if (!activeWallet || !chainId) {
				throw new Error('Wallet not connected');
			}

			const contractConfig = CONTRACTS[chainId];
			console.log('contractConfig', contractConfig);

			if (!contractConfig) {
				throw new Error('Contracts not configured for this chain');
			}

			// Get the full chain object from the wallet
			const connectedChain = activeWallet.getChain();
			console.log('connectedChain', connectedChain);

			if (!connectedChain) {
				throw new Error('Could not determine connected chain.');
			}

			toast.info('Please confirm the transaction in your wallet to revoke access.');

			const escrowContract = getContract({
				client,
				chain: connectedChain,
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const revokeTx = prepareContractCall({
				contract: escrowContract,
				method: 'cancelSpendingLimit',
			});
			await new Promise((resolve, reject) => {
				send(revokeTx, { onSuccess: resolve, onError: reject });
			});
		},
		onSuccess: async () => {
			toast.success('Access Revoked', {
				description: 'The AI agent can no longer spend your tokens.',
			});

			// Wait 2 seconds to allow the RPC node to index the new state.
			// Without this, invalidateQueries fetches stale data instantly.
			await wait(2000);

			await queryClient.invalidateQueries({ queryKey: ['usagePlan'] });
			onOpenChange(false);
		},
		onError: error => {
			toast.error('Revoke Failed', {
				description: error.message || 'Could not revoke access. Please try again.',
			});
		},
	});

	const handleRefundAll = async () => {
		if (!stuckRequests) {
			return;
		}

		const refundable = stuckRequests.filter(req => req.isRefundable);

		if (refundable.length === 0) {
			return;
		}

		setIsRefundingAll(true);
		toast.info('Processing Refunds', {
			description: `You will need to confirm ${refundable.length} transactions.`,
		});

		// We process sequentially to avoid nonce issues in the wallet
		await refundable.reduce(async (previousPromise, req) => {
			// 1. Wait for the previous item to finish
			const shouldContinue = await previousPromise;

			// 2. If a previous item failed, skip this one (effectively a "break")
			if (!shouldContinue) return false;

			try {
				await processRefundMutation.mutateAsync({ answerMessageId: req.id });
				return true; // Continue to the next item
			} catch (error) {
				console.error('Refund failed for', req.id, error);
				return false; // Stop processing subsequent items
			}
		}, Promise.resolve(true));

		setIsRefundingAll(false);
	};

	const onSubmit = data => {
		const limitInWei = ethers.parseUnits(data.limit.toString(), 18);
		const nowInSeconds = Math.floor(Date.now() / 1000);
		const expiresAtTimestamp = nowInSeconds + data.days * 24 * 60 * 60;
		setPlanMutation.mutate({ limitInWei, expiresAtTimestamp });
	};

	const handleRevoke = () => {
		revokeMutation.mutate();
	};

	const handleFaucetRequest = async () => {
		setIsRequestingTokens(true);

		const address = activeWallet?.getAccount()?.address;
		const { success, txHash } = await requestTestTokens(address);
		console.log('success', success, 'txHash', txHash);

		if (success && txHash) {
			// 1. Show initial Toast with Explorer Link
			toast.info('Tokens Sent', {
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
				const maxAttempts = 20; // Try for ~40 seconds (2s interval)
				while (attempts < maxAttempts) {
					try {
						// Check if receipt exists
						// eslint-disable-next-line no-await-in-loop
						const receipt = await eth_getTransactionReceipt(rpcRequest, { hash: txHash });
						console.log('receipt', receipt);

						if (receipt) {
							toast.success('Tokens Received', {
								description: '100 ABLE tokens have been added to your wallet.',
							});

							// Refresh balance
							// eslint-disable-next-line no-await-in-loop
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

		setIsRequestingTokens(false);
	};

	const isProcessing = setPlanMutation.isPending || revokeMutation.isPending;
	const refundableCount = stuckRequests?.filter(r => r.isRefundable).length || 0;

	const renderPriceInfo = () => {
		if (isLocalnet) {
			return (
				<div className="flex items-center justify-end text-sm text-muted-foreground">
					<PriceInfoDialog
						title="Local Test Price"
						description="You are on a local test network. The USD value is an estimate based on the planned TGE price of $0.015."
					/>
					<span>
						Est. Value: ≈ $
						{usdValue.toLocaleString(undefined, {
							minimumFractionDigits: 2,
							maximumFractionDigits: 2,
						})}{' '}
						USD
					</span>
				</div>
			);
		}

		if (isLoadingPrice) {
			return (
				<div className="flex items-center justify-end text-sm text-muted-foreground">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					<span>Fetching live price...</span>
				</div>
			);
		}

		if (isErrorPrice) {
			return (
				<div className="flex items-center justify-end text-sm text-destructive">
					<AlertCircle className="mr-2 h-4 w-4" />
					<span>Could not fetch live price.</span>
				</div>
			);
		}

		if (usdValue !== null) {
			return (
				<div className="flex items-center justify-end text-sm text-muted-foreground">
					<PriceInfoDialog
						title="Live Market Value"
						description="The USD value is a real-time estimate based on the current market price of ABLE and may fluctuate."
					/>
					<span>
						Current Value: ≈ $
						{usdValue.toLocaleString(undefined, {
							minimumFractionDigits: 2,
							maximumFractionDigits: 2,
						})}{' '}
						USD
					</span>
				</div>
			);
		}

		return null;
	};

	return (
		<Dialog
			open={open}
			onOpenChange={openState => {
				if (!isProcessing && !isRefundingAll) {
					onOpenChange(openState);
				}
			}}
		>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>{existingPlan ? 'Manage' : 'Set'} Your Spending Limit</DialogTitle>
					<DialogDescription>
						Approve a total amount of ABLE tokens the AI agent can use. This requires{' '}
						{existingPlan ? 'up to ' : ''}two transactions.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
					<div className="space-y-2">
						<Label htmlFor="limit">Spending Limit (ABLE)</Label>
						<Input
							id="limit"
							type="number"
							placeholder={String(DEFAULT_TOKEN_LIMIT)}
							{...register('limit', { valueAsNumber: true })}
							disabled={
								hasPendingPrompts ||
								isProcessing ||
								isRefundingAll ||
								setPlanMutation.isPending ||
								revokeMutation.isPending
							}
						/>
						{errors.limit && <p className="text-sm text-destructive">{errors.limit.message}</p>}

						{isExceedingBalance && (
							<div className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 border border-amber-500/20">
								<div className="flex items-center gap-2 mb-2">
									<AlertCircle className="w-4 h-4" />
									<span className="font-semibold">Insufficient Balance</span>
								</div>
								<p className="mb-3">
									You have {formattedBalance.toFixed(2)} ABLE, but you are trying to set a limit of{' '}
									{currentLimit}.
								</p>

								{isTestnet && (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										className="w-full h-8 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border-amber-500/20"
										onClick={handleFaucetRequest}
										disabled={isRequestingTokens}
									>
										{isRequestingTokens ? (
											<>
												<Loader2 className="mr-2 h-3 w-3 animate-spin" /> Sending Tokens...
											</>
										) : (
											'Get 100 Testnet ABLE'
										)}
									</Button>
								)}
							</div>
						)}

						{renderPriceInfo()}
					</div>
					<div className="space-y-2">
						<Label htmlFor="days">Expires In (Days)</Label>
						<Input
							id="days"
							type="number"
							placeholder={String(DEFAULT_DAYS)}
							{...register('days', { valueAsNumber: true })}
							disabled={
								hasPendingPrompts ||
								isProcessing ||
								isRefundingAll ||
								setPlanMutation.isPending ||
								revokeMutation.isPending
							}
						/>
						{errors.days && <p className="text-sm text-destructive">{errors.days.message}</p>}
					</div>

					{hasPendingPrompts && stuckRequests && stuckRequests.length > 0 && (
						<div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
							<div className="flex items-center justify-between mb-2">
								<div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
									<AlertCircle className="h-4 w-4" />
									<span className="text-sm font-semibold">Pending Prompts Detected</span>
								</div>
								{refundableCount > 1 && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
										onClick={handleRefundAll}
										disabled={isRefundingAll}
									>
										{isRefundingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refund All'}
									</Button>
								)}
							</div>
							<p className="text-xs text-muted-foreground mb-3">
								You have prompts that haven't completed. You cannot change or revoke your plan until
								they finalize or are refunded.
							</p>

							<div className="space-y-2 max-h-40 overflow-y-auto">
								{stuckRequests.map(req => (
									<div
										key={req.id}
										className="flex items-center justify-between bg-background p-2 rounded border text-xs"
									>
										<span>
											Request #{req.id}{' '}
											<span className="text-muted-foreground">
												({formatDistanceToNow(req.createdAt)} ago)
											</span>
										</span>

										{req.isRefundable ? (
											<Button
												size="sm"
												variant="outline"
												type="button"
												className="h-6 text-xs"
												onClick={e => {
													e.preventDefault();
													processRefundMutation.mutate({ answerMessageId: req.id });
												}}
												disabled={processRefundMutation.isPending || isRefundingAll}
											>
												{processRefundMutation.isPending && !isRefundingAll ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													'Refund'
												)}
											</Button>
										) : (
											<span className="text-muted-foreground italic px-2">Wait 1h to refund</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					<DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
						<div className="w-full sm:w-auto">
							{existingPlan && (
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											type="button"
											variant="destructive"
											disabled={
												hasPendingPrompts ||
												isProcessing ||
												isRefundingAll ||
												setPlanMutation.isPending ||
												revokeMutation.isPending
											}
											className="w-full sm:w-auto"
										>
											{revokeMutation.isPending ? (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											) : (
												<Trash2 className="mr-2 h-4 w-4" />
											)}
											{revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Are you sure?</AlertDialogTitle>
											<AlertDialogDescription>
												This will revoke the AI agent's permission to spend your ABLE tokens. You
												will need to set a new limit to continue using the service. This action
												requires a transaction.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel disabled={revokeMutation.isPending}>
												Cancel
											</AlertDialogCancel>
											<AlertDialogAction onClick={handleRevoke} disabled={revokeMutation.isPending}>
												{revokeMutation.isPending && (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												)}
												{revokeMutation.isPending ? 'Revoking...' : 'Confirm Revoke'}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>

						<div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={
									isProcessing ||
									isRefundingAll ||
									setPlanMutation.isPending ||
									revokeMutation.isPending
								}
								className="w-full sm:w-auto"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									hasPendingPrompts ||
									!isValid ||
									isProcessing ||
									isRefundingAll ||
									setPlanMutation.isPending ||
									revokeMutation.isPending
								}
								className="w-full sm:w-auto"
							>
								{setPlanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								{setPlanMutation.isPending ? statusText : existingPlan ? 'Save Changes' : 'Confirm'}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
