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
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';

const renameSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	title: z
		.string()
		.trim()
		.min(1, { message: 'Title cannot be empty.' })
		.max(100, { message: 'Title cannot be longer than 100 characters.' }),
});

type RenameFormValues = z.infer<typeof renameSchema>;

interface RenameConversationModalProps {
	open: boolean;
	onOpenChange: (_open: boolean) => void;
	onRenameSubmit: (_title: string) => void;
	isProcessing: boolean;
	error: Error | null;
	conversationToRename: { id: string; title: string } | null;
}

export default function RenameConversationModal({
	open,
	onOpenChange,
	onRenameSubmit,
	isProcessing,
	error,
	conversationToRename,
}: RenameConversationModalProps) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isValid },
		setFocus,
	} = useForm<RenameFormValues>({
		resolver: zodResolver(renameSchema),
		mode: 'onChange',
		defaultValues: { title: '' },
	});
	// A rename pays a fee; while that is switched off the dialog says so and sends nothing.
	const renameSwitchedOff = useSwitchedOffReason('metadata');

	useEffect(() => {
		if (conversationToRename && open) {
			reset({ title: conversationToRename.title });
			setTimeout(() => setFocus('title'), 100);
		}
	}, [conversationToRename, open, reset, setFocus]);

	const onSubmit = (data: RenameFormValues) => {
		if (renameSwitchedOff) return;
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
					{renameSwitchedOff && (
						<p className="text-sm text-muted-foreground">{renameSwitchedOff}</p>
					)}
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
						<Button type="submit" disabled={isProcessing || !isValid || !!renameSwitchedOff}>
							{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isProcessing ? 'Renaming...' : 'Rename'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
