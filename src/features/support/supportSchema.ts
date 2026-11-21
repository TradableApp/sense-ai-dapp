import { z } from 'zod';

const supportSchema = z.object({
	topic: z
		.string({ required_error: 'Please select a topic.' })
		.min(1, { message: 'Please select a topic.' }),
	subject: z
		.string()
		.trim()
		.min(5, { message: 'Subject must be at least 5 characters.' })
		.max(150, { message: 'Subject cannot exceed 150 characters.' }),
	request: z
		.string()
		.trim()
		.min(20, { message: 'Request must be at least 20 characters.' })
		.max(2000, { message: 'Request cannot exceed 2000 characters.' }),
	email: z
		.string()
		.min(1, { message: 'Email address is required.' })
		.email({ message: 'Please enter a valid email address.' }),
});

export type SupportValues = z.infer<typeof supportSchema>;

export default supportSchema;
