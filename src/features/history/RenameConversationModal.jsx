import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
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
import { renameConversation } from '@/lib/mockApi';
import { closeRenameModal } from '@/store/chatSlice';

const renameSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, { message: 'Title cannot be empty.' })
		.max(100, { message: 'Title cannot be longer than 100 characters.' }),
});

export default function RenameConversationModal() {
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const { isRenameModalOpen, conversationToRename } = useSelector(state => state.chat);

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting },
		setFocus,
	} = useForm({
		resolver: zodResolver(renameSchema),
		defaultValues: { title: '' },
	});

	useEffect(() => {
		// --- FIX: Add a guard clause to ensure conversationToRename exists ---
		if (conversationToRename) {
			reset({ title: conversationToRename.title });
			// The timeout gives the dialog time to complete its animation before focusing.
			setTimeout(() => setFocus('title'), 100);
		}
	}, [conversationToRename, reset, setFocus]);

	const renameMutation = useMutation({
		mutationFn: renameConversation,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['conversations'] });
			dispatch(closeRenameModal());
		},
	});

	const onSubmit = data => {
		if (!conversationToRename) return;
		renameMutation.mutate({ id: conversationToRename.id, newTitle: data.title });
	};

	const handleOpenChange = isOpen => {
		if (!isOpen) {
			renameMutation.reset();
			dispatch(closeRenameModal());
		}
	};

	const isProcessing = isSubmitting || renameMutation.isPending;

	return (
		<Dialog open={isRenameModalOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename Conversation</DialogTitle>
					<DialogDescription>Enter a new name for this conversation.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
					<Input placeholder="Conversation title" disabled={isProcessing} {...register('title')} />

					{errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}

					{renameMutation.isError && (
						<p className="text-sm text-destructive">Failed to rename. Please try again.</p>
					)}

					<DialogFooter className="pt-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => dispatch(closeRenameModal())}
							disabled={isProcessing}
						>
							Cancel
						</Button>

						<Button type="submit" disabled={isProcessing}>
							{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isProcessing ? 'Renaming...' : 'Rename'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
