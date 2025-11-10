import { useEffect, useMemo, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { AlertCircle, Info, Loader2, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { getContract, prepareContractCall } from 'thirdweb';
import { useActiveWallet, useSendTransaction } from 'thirdweb/react';
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
import CONTRACTS from '@/config/contracts';
import { client } from '@/config/thirdweb';
import useTokenPrice from '@/hooks/useTokenPrice';

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
const LOCAL_CHAIN_ID = 31337;

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
	const { mutate: send } = useSendTransaction();
	const queryClient = useQueryClient();
	const [statusText, setStatusText] = useState('');

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

	const setPlanMutation = useMutation({
		mutationFn: async ({ limitInWei, expiresAtTimestamp }) => {
			if (!activeWallet || !chainId) throw new Error('Wallet not connected');
			const contractConfig = CONTRACTS[chainId];
			if (!contractConfig) throw new Error('Contracts not configured for this chain');

			setStatusText('1/2: Approving...');
			toast.info('Step 1/2: Please approve the token spending limit in your wallet.');

			const tokenContract = getContract({
				client,
				chain: { id: chainId },
				address: contractConfig.token.address,
				abi: contractConfig.token.abi,
			});
			const approveTx = prepareContractCall({
				contract: tokenContract,
				method: 'approve',
				params: [contractConfig.escrow.address, limitInWei],
			});
			await new Promise((resolve, reject) => {
				send(approveTx, { onSuccess: resolve, onError: reject });
			});

			setStatusText('2/2: Setting Limit...');
			toast.info('Step 2/2: Please confirm setting the new spending limit in your wallet.');

			const escrowContract = getContract({
				client,
				chain: { id: chainId },
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const setSubTx = prepareContractCall({
				contract: escrowContract,
				method: 'setSubscription',
				params: [limitInWei, expiresAtTimestamp],
			});
			await new Promise((resolve, reject) => {
				send(setSubTx, { onSuccess: resolve, onError: reject });
			});
		},
		onSuccess: () => {
			toast.success('Spending Limit Set!', {
				description: 'Your new plan is now active.',
			});
			queryClient.invalidateQueries({ queryKey: ['usagePlan'] });
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
			if (!activeWallet || !chainId) throw new Error('Wallet not connected');
			const contractConfig = CONTRACTS[chainId];
			if (!contractConfig) throw new Error('Contracts not configured for this chain');

			toast.info('Please confirm the transaction in your wallet to revoke access.');
			setStatusText('Revoking...');

			const escrowContract = getContract({
				client,
				chain: { id: chainId },
				address: contractConfig.escrow.address,
				abi: contractConfig.escrow.abi,
			});
			const revokeTx = prepareContractCall({
				contract: escrowContract,
				method: 'cancelSubscription',
			});
			await new Promise((resolve, reject) => {
				send(revokeTx, { onSuccess: resolve, onError: reject });
			});
		},
		onSuccess: () => {
			toast.success('Access Revoked', {
				description: 'The AI agent can no longer spend your tokens.',
			});
			queryClient.invalidateQueries({ queryKey: ['usagePlan'] });
			onOpenChange(false);
		},
		onError: error => {
			toast.error('Revoke Failed', {
				description: error.message || 'Could not revoke access. Please try again.',
			});
		},
	});

	const onSubmit = data => {
		const limitInWei = ethers.parseUnits(data.limit.toString(), 18);
		const nowInSeconds = Math.floor(Date.now() / 1000);
		const expiresAtTimestamp = nowInSeconds + data.days * 24 * 60 * 60;
		setPlanMutation.mutate({ limitInWei, expiresAtTimestamp });
	};

	const handleRevoke = () => {
		revokeMutation.mutate();
	};

	const isProcessing = setPlanMutation.isPending || revokeMutation.isPending;

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
				if (!isProcessing) {
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
							disabled={isProcessing}
						/>
						{errors.limit && <p className="text-sm text-destructive">{errors.limit.message}</p>}
						{renderPriceInfo()}
					</div>
					<div className="space-y-2">
						<Label htmlFor="days">Expires In (Days)</Label>
						<Input
							id="days"
							type="number"
							placeholder={String(DEFAULT_DAYS)}
							{...register('days', { valueAsNumber: true })}
							disabled={isProcessing}
						/>
						{errors.days && <p className="text-sm text-destructive">{errors.days.message}</p>}
					</div>

					<DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
						<div>
							{existingPlan && (
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button variant="destructive" disabled={isProcessing}>
											<Trash2 className="mr-2 h-4 w-4" />
											Revoke Access
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
											<AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
											<AlertDialogAction onClick={handleRevoke} disabled={isProcessing}>
												{revokeMutation.isPending && (
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												)}
												Confirm Revoke
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>

						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isProcessing}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!isValid || isProcessing}>
								{setPlanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								{isProcessing ? statusText : existingPlan ? 'Save Changes' : 'Confirm'}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
