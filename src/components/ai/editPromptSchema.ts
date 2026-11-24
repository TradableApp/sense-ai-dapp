import { z } from 'zod';

const editPromptSchema = z.object({
	content: z.string().trim().min(1, { message: 'Message cannot be empty.' }),
});

export default editPromptSchema;
