import { z } from 'zod';

const promptSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(5000),
});

export default promptSchema;
