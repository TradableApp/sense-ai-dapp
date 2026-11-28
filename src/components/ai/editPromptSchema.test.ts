import { describe, expect, it } from 'vitest';

import promptSchema from '@/features/chat/promptSchema';
import { messagesFor } from '@/test/formIssues';

import editPromptSchema from './editPromptSchema';

/** The composer's limit: saving an edit sends a paid prompt, which the oracle holds to it. */
const MAX_PROMPT = promptSchema.shape.prompt.maxLength ?? Number.NaN;

describe('editPromptSchema', () => {
	it('refuses an empty or blank edit with the words the edit box shows', () => {
		expect(messagesFor(editPromptSchema, { content: '' })).toEqual({
			content: ['Message cannot be empty.'],
		});
		expect(messagesFor(editPromptSchema, { content: ' \n\t ' })).toEqual({
			content: ['Message cannot be empty.'],
		});
	});

	it('accepts text and trims it', () => {
		expect(editPromptSchema.parse({ content: '  edited prompt  ' })).toEqual({
			content: 'edited prompt',
		});
	});

	it('accepts an edit of the maximum length, counted after trimming', () => {
		const longest = 'a'.repeat(MAX_PROMPT);
		expect(editPromptSchema.parse({ content: `  ${longest}  ` })).toEqual({ content: longest });
	});

	it('refuses an edit one character over the maximum, in the words the composer gives', () => {
		const over = 'a'.repeat(MAX_PROMPT + 1);
		expect(messagesFor(editPromptSchema, { content: over }).content).toEqual(
			messagesFor(promptSchema, { prompt: over }).prompt,
		);
	});

	it('has the same limit as the composer', () => {
		expect(editPromptSchema.shape.content.maxLength).toBe(MAX_PROMPT);
	});
});
