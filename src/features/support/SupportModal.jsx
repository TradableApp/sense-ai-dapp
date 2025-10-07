import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import { getUserEmail } from 'thirdweb/wallets';
import { z } from 'zod';

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import Textarea from '@/components/ui/textarea';
import { client } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider';
import { sendSupportRequest } from '@/lib/contactService';
import { closeModal } from '@/store/uiSlice';

const supportSchema = z.object({
	topic: z
		.string({ required_error: 'Please select a topic.' })
		.min(1, { message: 'Please select a topic.' }),
	subject: z
		.string()
		.trim()
		.min(5, { message: 'Subject must be at least 5 characters.' })
		.max(150, { message: 'Subject cannot exceed 150 characters.' }),
	request: z
		.string()
		.trim()
		.min(20, { message: 'Request must be at least 20 characters.' })
		.max(2000, { message: 'Request cannot exceed 2000 characters.' }),
	email: z
		.string()
		.min(1, { message: 'Email address is required.' })
		.email({ message: 'Please enter a valid email address.' }),
});

const supportTopics = [
	'General Inquiry',
	'Platform Issue',
	'Wallet or Exchange Request',
	'Billing Question',
	'Report a Bug',
];

export default function SupportModal() {
	const dispatch = useDispatch();
	const { ownerAddress, activeWallet } = useSession();
	const isOpen = useSelector(state => state.ui.currentModal.type === 'Support');

	const {
		register,
		handleSubmit,
		reset,
		control,
		formState: { errors, isSubmitting, isValid },
	} = useForm({
		resolver: zodResolver(supportSchema),
		mode: 'onChange',
		defaultValues: { topic: '', subject: '', request: '', email: '' },
	});

	useEffect(() => {
		const fetchAndSetEmail = async () => {
			try {
				const userEmail = await getUserEmail({ client });
				reset({ topic: '', subject: '', request: '', email: userEmail || '' });
			} catch (error) {
				console.warn('[SupportModal] Could not fetch email for auto-population:', error);
				reset({ topic: '', subject: '', request: '', email: '' });
			}
		};

		if (isOpen) {
			fetchAndSetEmail();
		}
	}, [isOpen, reset]);

	const supportMutation = useMutation({
		mutationFn: variables => sendSupportRequest(variables.data, variables.userAddress),
		onSuccess: () => {
			toast.success('Request Submitted', {
				description: 'Our team has received your request and will get back to you shortly.',
			});
			dispatch(closeModal());
		},
		onError: error => {
			toast.error('Submission Failed', {
				description:
					error.message || 'There was a problem submitting your request. Please try again.',
			});
		},
	});

	const onSubmit = data => {
		const displayName = activeWallet?.getAccount()?.ens?.name; // Get ENS name if available
		supportMutation.mutate({ data, userAddress: ownerAddress, displayName });
	};

	const isProcessing = isSubmitting || supportMutation.isPending;

	return (
		<Dialog open={isOpen} onOpenChange={() => dispatch(closeModal())}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Submit a Support Request</DialogTitle>
					<DialogDescription>
						Our team is here to help. Please provide as much detail as possible.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					<div className="space-y-2">
						<Controller
							control={control}
							name="topic"
							render={({ field }) => (
								<Select
									onValueChange={field.onChange}
									defaultValue={field.value}
									disabled={isProcessing}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a topic..." />
									</SelectTrigger>
									<SelectContent>
										{supportTopics.map(topic => (
											<SelectItem key={topic} value={topic}>
												{topic}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						/>
						{errors.topic && <p className="text-sm text-destructive">{errors.topic.message}</p>}
					</div>

					<div className="space-y-2">
						<Input placeholder="Subject" disabled={isProcessing} {...register('subject')} />
						{errors.subject && <p className="text-sm text-destructive">{errors.subject.message}</p>}
					</div>

					<div className="space-y-2">
						<Textarea
							placeholder="Please describe your issue in detail..."
							className="min-h-[120px]"
							disabled={isProcessing}
							{...register('request')}
						/>
						{errors.request && <p className="text-sm text-destructive">{errors.request.message}</p>}
					</div>

					<div className="space-y-2">
						<div className="relative">
							<Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								type="email"
								placeholder="Your contact email"
								className="pl-9"
								disabled={isProcessing}
								{...register('email')}
							/>
						</div>
						{errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => dispatch(closeModal())}
							disabled={isProcessing}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!isValid || isProcessing}>
							{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isProcessing ? 'Submitting...' : 'Submit Request'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
