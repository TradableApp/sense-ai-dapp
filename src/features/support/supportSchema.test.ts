import { describe, expect, it } from 'vitest';

import { ACCEPTED_EMAILS, REFUSED_EMAILS } from '@/test/emailCases';
import { messagesFor, resolverMessages } from '@/test/formIssues';

import supportSchema from './supportSchema';

const VALID = {
	topic: 'General Inquiry',
	subject: 'A subject',
	request: 'A request that is long enough.',
	email: 'user@example.com',
};

describe('supportSchema', () => {
	it('accepts a valid request and trims subject and request', () => {
		expect(
			supportSchema.parse({
				...VALID,
				subject: ` ${VALID.subject} `,
				request: ` ${VALID.request} `,
			}),
		).toEqual(VALID);
	});

	it('asks for a topic when none was chosen or it is empty', async () => {
		const { topic: _topic, ...noTopic } = VALID;
		expect(messagesFor(supportSchema, noTopic)).toEqual({ topic: ['Please select a topic.'] });
		expect(messagesFor(supportSchema, { ...VALID, topic: undefined })).toEqual({
			topic: ['Please select a topic.'],
		});
		expect(messagesFor(supportSchema, { ...VALID, topic: '' })).toEqual({
			topic: ['Please select a topic.'],
		});
		expect(await resolverMessages(supportSchema, { ...VALID, topic: undefined })).toEqual({
			topic: 'Please select a topic.',
		});
	});

	it('refuses a subject under 5 or over 150 characters', () => {
		expect(messagesFor(supportSchema, { ...VALID, subject: ' abcd ' })).toEqual({
			subject: ['Subject must be at least 5 characters.'],
		});
		expect(messagesFor(supportSchema, { ...VALID, subject: 'a'.repeat(151) })).toEqual({
			subject: ['Subject cannot exceed 150 characters.'],
		});
	});

	it('refuses a request under 20 or over 2000 characters', () => {
		expect(messagesFor(supportSchema, { ...VALID, request: 'a'.repeat(19) })).toEqual({
			request: ['Request must be at least 20 characters.'],
		});
		expect(messagesFor(supportSchema, { ...VALID, request: 'a'.repeat(2001) })).toEqual({
			request: ['Request cannot exceed 2000 characters.'],
		});
	});

	it('gives both email messages for an empty address, and the form shows the first', async () => {
		expect(messagesFor(supportSchema, { ...VALID, email: '' })).toEqual({
			email: ['Email address is required.', 'Please enter a valid email address.'],
		});
		expect(await resolverMessages(supportSchema, { ...VALID, email: '' })).toEqual({
			email: 'Email address is required.',
		});
	});

	it.each(REFUSED_EMAILS)('refuses %s', email => {
		expect(messagesFor(supportSchema, { ...VALID, email })).toEqual({
			email: ['Please enter a valid email address.'],
		});
	});

	it.each(ACCEPTED_EMAILS)('accepts %s', email => {
		expect(messagesFor(supportSchema, { ...VALID, email })).toEqual({});
	});
});
