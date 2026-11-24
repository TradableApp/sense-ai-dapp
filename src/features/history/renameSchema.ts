import { z } from 'zod';

const renameSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	title: z
		.string()
		.trim()
		.min(1, { message: 'Title cannot be empty.' })
		.max(100, { message: 'Title cannot be longer than 100 characters.' }),
});

export type RenameFormValues = z.infer<typeof renameSchema>;

export default renameSchema;
