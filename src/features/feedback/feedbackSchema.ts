import { z } from 'zod';

const feedbackSchema = z.object({
	feedback: z
		.string()
		.trim()
		.min(10, { message: 'Please provide at least 10 characters of feedback.' })
		.max(2000, { message: 'Feedback cannot exceed 2000 characters.' }),
	email: z
		.string()
		.min(1, { message: 'Email address is required.' })
		.email({ message: 'Please enter a valid email address.' }),
});

export type FeedbackValues = z.infer<typeof feedbackSchema>;

export default feedbackSchema;
