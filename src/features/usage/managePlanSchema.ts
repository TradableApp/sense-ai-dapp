import { z } from 'zod';

/**
 * The words for a wrong type: a value that is not a number (an empty input arrives as NaN) or a
 * fraction of a day (zod reports a failed `.int()` as a wrong type). A missing value is "Required",
 * as it always was. Other issues keep the message their own check gives.
 */
const typeError = (message: string) => (issue: { code?: string; input?: unknown }) => {
	if (issue.code !== 'invalid_type') return undefined;
	return issue.input === undefined ? 'Required' : message;
};

const managePlanSchema = z.object({
	limit: z
		.number({ error: typeError('Limit must be a number.') })
		.positive({ message: 'Limit must be greater than zero.' }),
	days: z
		.number({ error: typeError('Days must be a number.') })
		.int()
		.positive({ message: 'Duration must be at least one day.' }),
});

export type ManagePlanValues = z.infer<typeof managePlanSchema>;

export default managePlanSchema;
