import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
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
import Textarea from '@/components/ui/textarea';
import { useSession } from '@/features/auth/SessionProvider';
import { sendFeedback } from '@/lib/contactService';
import { closeModal } from '@/store/uiSlice';

const feedbackSchema = z.object({
	feedback: z
		.string()
		.trim()
		.min(10, { message: 'Please provide at least 10 characters of feedback.' })
		.max(2000, { message: 'Feedback cannot exceed 2000 characters.' }),
});

export default function FeedbackModal() {
	const dispatch = useDispatch();
	const { ownerAddress } = useSession();
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
		defaultValues: { feedback: '' },
	});

	useEffect(() => {
		if (isOpen) {
			reset({ feedback: '' });
			setTimeout(() => setFocus('feedback'), 100);
		}
	}, [isOpen, reset, setFocus]);

	const feedbackMutation = useMutation({
		mutationFn: variables => sendFeedback(variables.feedbackText, variables.userAddress),
		onSuccess: () => {
			toast.success('Thank you!', {
				description: 'Your feedback has been submitted successfully.',
			});
			dispatch(closeModal());
		},
		onError: error => {
			toast.error('Submission Failed', {
				description:
					error.message || 'There was a problem submitting your feedback. Please try again.',
			});
		},
	});

	const onSubmit = data => {
		feedbackMutation.mutate({ feedbackText: data.feedback, userAddress: ownerAddress });
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
						We'd love to hear your thoughts on what we can improve. Your feedback is invaluable.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					<div className="space-y-2">
						<Textarea
							placeholder="Tell us about a bug you found or an idea for a new feature..."
							className="min-h-[120px]"
							disabled={isProcessing}
							{...register('feedback')}
						/>
						{errors.feedback && (
							<p className="text-sm text-destructive">{errors.feedback.message}</p>
						)}
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
