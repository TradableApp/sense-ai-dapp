import { z } from 'zod';

/** The longest conversation title the oracle accepts, for a rename and a branch's origin. */
export const MAX_TITLE_CHARS = 100;

const renameSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	title: z
		.string()
		.trim()
		.min(1, { message: 'Title cannot be empty.' })
		.max(MAX_TITLE_CHARS, { message: 'Title cannot be longer than 100 characters.' }),
});

export type RenameFormValues = z.infer<typeof renameSchema>;

export default renameSchema;
