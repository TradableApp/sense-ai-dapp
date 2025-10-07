import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
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
import Textarea from '@/components/ui/textarea';
import { client } from '@/config/thirdweb';
import { useSession } from '@/features/auth/SessionProvider';
import { sendFeedback } from '@/lib/contactService';
import { closeModal } from '@/store/uiSlice';

const feedbackSchema = z.object({
	feedback: z
		.string()
		.trim()
		.min(10, { message: 'Please provide at least 10 characters of feedback.' })
		.max(2000, { message: 'Feedback cannot exceed 2000 characters.' }),
	email: z
		.string()
		.min(1, { message: 'Email address is required.' })
		.email({ message: 'Please enter a valid email address.' }),
});

export default function FeedbackModal() {
	const dispatch = useDispatch();
	const { ownerAddress, activeWallet } = useSession();
	const isOpen = useSelector(state => state.ui.currentModal.type === 'Feedback');

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting, isValid },
		setFocus,
	} = useForm({
		resolver: zodResolver(feedbackSchema),
		mode: 'onChange',
		defaultValues: { feedback: '', email: '' },
	});

	useEffect(() => {
		const fetchAndSetEmail = async () => {
			try {
				const userEmail = await getUserEmail({ client });
				reset({ feedback: '', email: userEmail || '' });
			} catch (error) {
				console.warn('[FeedbackModal] Could not fetch email for auto-population:', error);
				reset({ feedback: '', email: '' });
			}
			setTimeout(() => setFocus('feedback'), 100);
		};

		if (isOpen) {
			fetchAndSetEmail();
		}
	}, [isOpen, reset, setFocus]);

	const feedbackMutation = useMutation({
		mutationFn: variables =>
			sendFeedback(variables.data, variables.userAddress, variables.displayName),
		onSuccess: () => {
			toast.success('Thank you!', {
				description: 'Your feedback has been submitted successfully.',
			});
			dispatch(closeModal());
		},
		onError: error => {
			toast.error('Submission Failed', {
				description: error.message || 'There was a problem submitting your feedback.',
			});
		},
	});

	const onSubmit = data => {
		const displayName = activeWallet?.getAccount()?.ens?.name;
		feedbackMutation.mutate({ data, userAddress: ownerAddress, displayName });
	};

	const handleOpenChange = open => {
		if (!open) {
			feedbackMutation.reset();
			dispatch(closeModal());
		}
	};

	const isProcessing = isSubmitting || feedbackMutation.isPending;

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Provide Feedback</DialogTitle>
					<DialogDescription>
						We'd love to hear your thoughts. Your feedback is invaluable.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					<div className="space-y-2">
						<Textarea
							placeholder="Tell us about a bug or an idea for a new feature..."
							className="min-h-[120px]"
							disabled={isProcessing}
							{...register('feedback')}
						/>
						{errors.feedback && (
							<p className="text-sm text-destructive">{errors.feedback.message}</p>
						)}
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
							{isProcessing ? 'Submitting...' : 'Submit Feedback'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
