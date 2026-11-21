import { describe, expect, it } from 'vitest';

import { messagesFor, resolverMessages } from '@/test/formIssues';

import managePlanSchema from './managePlanSchema';

const VALID = { limit: 100, days: 365 };

describe('managePlanSchema', () => {
	it('accepts a positive limit and a whole number of days', () => {
		expect(managePlanSchema.parse({ limit: 0.5, days: 1 })).toEqual({ limit: 0.5, days: 1 });
	});

	// An empty number input reaches the schema as NaN (`valueAsNumber`).
	it('says a limit or duration that is not a number must be a number', async () => {
		expect(messagesFor(managePlanSchema, { limit: Number.NaN, days: Number.NaN })).toEqual({
			limit: ['Limit must be a number.'],
			days: ['Days must be a number.'],
		});
		expect(messagesFor(managePlanSchema, { limit: '100', days: '365' })).toEqual({
			limit: ['Limit must be a number.'],
			days: ['Days must be a number.'],
		});
		expect(await resolverMessages(managePlanSchema, { ...VALID, limit: Number.NaN })).toEqual({
			limit: 'Limit must be a number.',
		});
	});

	it('says a missing limit or duration is required', () => {
		expect(messagesFor(managePlanSchema, {})).toEqual({ limit: ['Required'], days: ['Required'] });
	});

	it('refuses a limit of zero or below', () => {
		expect(messagesFor(managePlanSchema, { ...VALID, limit: 0 })).toEqual({
			limit: ['Limit must be greater than zero.'],
		});
		expect(messagesFor(managePlanSchema, { ...VALID, limit: -1 })).toEqual({
			limit: ['Limit must be greater than zero.'],
		});
	});

	it('refuses a duration below one day', () => {
		expect(messagesFor(managePlanSchema, { ...VALID, days: 0 })).toEqual({
			days: ['Duration must be at least one day.'],
		});
	});

	// A fraction fails `.int()`, which zod reports as a wrong type, so the form shows the type message.
	it('refuses a fraction of a day with the words the form shows today', async () => {
		expect(messagesFor(managePlanSchema, { ...VALID, days: 1.5 })).toEqual({
			days: ['Days must be a number.'],
		});
		expect(messagesFor(managePlanSchema, { ...VALID, days: -1.5 })).toEqual({
			days: ['Days must be a number.', 'Duration must be at least one day.'],
		});
		expect(await resolverMessages(managePlanSchema, { ...VALID, days: 1.5 })).toEqual({
			days: 'Days must be a number.',
		});
	});
});
