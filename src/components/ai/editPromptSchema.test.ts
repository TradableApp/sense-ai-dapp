import { describe, expect, it } from 'vitest';

import { messagesFor } from '@/test/formIssues';

import editPromptSchema from './editPromptSchema';

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
});
