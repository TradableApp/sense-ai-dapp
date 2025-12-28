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
import { Button } from '@/components/ui/button';

const editSchema = z.object({
	content: z.string().trim().min(1, { message: 'Message cannot be empty.' }),
});

export default function EditPromptInput({ originalContent, onSave, onCancel }) {
	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm({
		resolver: zodResolver(editSchema),
		defaultValues: { content: originalContent },
	});

	return (
		<div className="w-full">
			<PromptInput onSubmit={handleSubmit(onSave)} errors={errors}>
				<PromptInputTextarea
					{...register('content')}
					autoFocus
					onKeyDown={e => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							handleSubmit(onSave)();
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
							disabled={!isValid || isSubmitting}
							status="editting"
							variant="default"
							size="default"
						/>
					</div>
				</PromptInputToolbar>
			</PromptInput>
		</div>
	);
}
