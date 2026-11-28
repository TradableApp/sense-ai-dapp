import { z } from 'zod';

/** The longest prompt, after trimming. Saving an edit sends a prompt, so the edit box shares it. */
export const MAX_PROMPT_CHARS = 5000;

const promptSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(MAX_PROMPT_CHARS),
});

export default promptSchema;
