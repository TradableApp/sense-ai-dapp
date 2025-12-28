import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
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

const renameSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	title: z
		.string()
		.trim()
		.min(1, { message: 'Title cannot be empty.' })
		.max(100, { message: 'Title cannot be longer than 100 characters.' }),
});

export default function RenameConversationModal({
	open,
	onOpenChange,
	onRenameSubmit,
	isProcessing,
	error,
	conversationToRename,
}) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isValid },
		setFocus,
	} = useForm({
		resolver: zodResolver(renameSchema),
		mode: 'onChange',
		defaultValues: { title: '' },
	});

	useEffect(() => {
		if (conversationToRename && open) {
			reset({ title: conversationToRename.title });
			setTimeout(() => setFocus('title'), 100);
		}
	}, [conversationToRename, open, reset, setFocus]);

	const onSubmit = data => {
		onRenameSubmit(data.title);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Rename Conversation</DialogTitle>
					<DialogDescription>Enter a new name for this conversation.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
					<Input placeholder="Conversation title" disabled={isProcessing} {...register('title')} />

					{errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
					{error && <p className="text-sm text-destructive">{error.message}</p>}

					<DialogFooter className="flex-col gap-2 pt-4 sm:flex-row sm:justify-end sm:gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isProcessing}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isProcessing || !isValid}>
							{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isProcessing ? 'Renaming...' : 'Rename'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
