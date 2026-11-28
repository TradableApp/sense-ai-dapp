import { z } from 'zod';

import { MAX_PROMPT_CHARS } from '@/features/chat/promptSchema';

const editPromptSchema = z.object({
	// Saving an edit sends a paid prompt, held to the composer's limit.
	content: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(MAX_PROMPT_CHARS),
});

export default editPromptSchema;
