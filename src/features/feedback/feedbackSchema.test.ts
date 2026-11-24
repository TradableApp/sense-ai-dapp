import { describe, expect, it } from 'vitest';

import { ACCEPTED_EMAILS, REFUSED_EMAILS } from '@/test/emailCases';
import { messagesFor, resolverMessages } from '@/test/formIssues';

import feedbackSchema from './feedbackSchema';

const VALID = { feedback: 'This is useful feedback.', email: 'user@example.com' };

describe('feedbackSchema', () => {
	it('accepts valid feedback and trims it', () => {
		expect(feedbackSchema.parse({ ...VALID, feedback: `  ${VALID.feedback}  ` })).toEqual(VALID);
	});

	it('refuses feedback under 10 characters, counted after trimming', () => {
		expect(messagesFor(feedbackSchema, { ...VALID, feedback: '  too short  ' })).toEqual({
			feedback: ['Please provide at least 10 characters of feedback.'],
		});
	});

	it('refuses feedback over 2000 characters', () => {
		expect(messagesFor(feedbackSchema, { ...VALID, feedback: 'a'.repeat(2001) })).toEqual({
			feedback: ['Feedback cannot exceed 2000 characters.'],
		});
	});

	it('gives both email messages for an empty address, and the form shows the first', async () => {
		expect(messagesFor(feedbackSchema, { ...VALID, email: '' })).toEqual({
			email: ['Email address is required.', 'Please enter a valid email address.'],
		});
		expect(await resolverMessages(feedbackSchema, { ...VALID, email: '' })).toEqual({
			email: 'Email address is required.',
		});
	});

	it.each(REFUSED_EMAILS)('refuses %s', email => {
		expect(messagesFor(feedbackSchema, { ...VALID, email })).toEqual({
			email: ['Please enter a valid email address.'],
		});
	});

	it.each(ACCEPTED_EMAILS)('accepts %s', email => {
		expect(messagesFor(feedbackSchema, { ...VALID, email })).toEqual({});
	});
});
