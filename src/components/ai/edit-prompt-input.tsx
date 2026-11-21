import { type KeyboardEvent, useId } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { MicIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
	PromptInput,
	PromptInputButton,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from '@/components/ai/prompt-input';
import SENDING_REASON from '@/components/ai/sendingReason';
import { Button } from '@/components/ui/button';
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';

const editSchema = z.object({
	content: z.string().trim().min(1, { message: 'Message cannot be empty.' }),
});

interface EditPromptInputProps {
	originalContent: string;
	onSave: (_data: { content: string }) => void;
	onCancel: () => void;
	/** True while a prompt is being sent: Save and Enter then send nothing. */
	isSending?: boolean;
	/** Set while this conversation holds a paid send not saved here: Save then sends nothing. */
	heldReason?: string | null;
}

export default function EditPromptInput({
	originalContent,
	onSave,
	onCancel,
	isSending = false,
	heldReason = null,
}: EditPromptInputProps) {
	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm({
		resolver: zodResolver(editSchema),
		defaultValues: { content: originalContent },
	});
	// Saving an edit sends the prompt again, so it is off while prompts are.
	// Nor is it sent twice: it waits while a prompt is being sent.
	const saveSwitchedOff = useSwitchedOffReason('prompt');
	const saveOff = saveSwitchedOff ?? (isSending ? SENDING_REASON : null) ?? heldReason;
	const reasonId = useId();
	const save = handleSubmit(data => {
		if (!saveOff) onSave(data);
	});

	return (
		<div className="w-full">
			<PromptInput onSubmit={save} errors={errors}>
				<PromptInputTextarea
					{...register('content')}
					autoFocus
					onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							save();
						}
					}}
				/>
				<PromptInputToolbar>
					<PromptInputButton disabled>
						<MicIcon size={16} />
						<span>Voice</span>
					</PromptInputButton>
					<div className="flex items-center gap-2">
						<Button type="button" variant="ghost" onClick={onCancel}>
							Cancel
						</Button>
						<PromptInputSubmit
							disabled={!isValid || isSubmitting || !!saveOff}
							aria-describedby={saveOff ? reasonId : undefined}
							status="editting"
							variant="default"
							size="default"
						/>
					</div>
				</PromptInputToolbar>
			</PromptInput>
			{saveOff && (
				<p id={reasonId} className="px-1 pt-1 text-xs text-muted-foreground">
					{saveOff}
				</p>
			)}
		</div>
	);
}
