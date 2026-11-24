import { describe, expect, it } from 'vitest';

import { messagesFor } from '@/test/formIssues';

import promptSchema from './promptSchema';

const MAX_PROMPT = 5000;

describe('promptSchema', () => {
	it('refuses an empty or blank prompt with the words the form gives', () => {
		expect(messagesFor(promptSchema, { prompt: '' })).toEqual({
			prompt: ['Message cannot be empty.'],
		});
		expect(messagesFor(promptSchema, { prompt: '   ' })).toEqual({
			prompt: ['Message cannot be empty.'],
		});
	});

	it('accepts a prompt of the maximum length, counted after trimming', () => {
		const longest = 'a'.repeat(MAX_PROMPT);
		expect(promptSchema.parse({ prompt: `  ${longest}  ` })).toEqual({ prompt: longest });
	});

	it('refuses a prompt one character over the maximum', () => {
		expect(Object.keys(messagesFor(promptSchema, { prompt: 'a'.repeat(MAX_PROMPT + 1) }))).toEqual([
			'prompt',
		]);
	});
});
