import { z } from 'zod';

const managePlanSchema = z.object({
	limit: z
		.number({ invalid_type_error: 'Limit must be a number.' })
		.positive({ message: 'Limit must be greater than zero.' }),
	days: z
		.number({ invalid_type_error: 'Days must be a number.' })
		.int()
		.positive({ message: 'Duration must be at least one day.' }),
});

export type ManagePlanValues = z.infer<typeof managePlanSchema>;

export default managePlanSchema;
