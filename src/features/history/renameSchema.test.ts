import { describe, expect, it } from 'vitest';

import { messagesFor } from '@/test/formIssues';

import renameSchema from './renameSchema';

describe('renameSchema', () => {
	it('refuses an empty or blank title', () => {
		expect(messagesFor(renameSchema, { title: '' })).toEqual({ title: ['Title cannot be empty.'] });
		expect(messagesFor(renameSchema, { title: '   ' })).toEqual({
			title: ['Title cannot be empty.'],
		});
	});

	it('refuses a title longer than 100 characters', () => {
		expect(messagesFor(renameSchema, { title: 'a'.repeat(101) })).toEqual({
			title: ['Title cannot be longer than 100 characters.'],
		});
	});

	it('accepts a 100-character title and trims it', () => {
		const longest = 'a'.repeat(100);
		expect(renameSchema.parse({ title: ` ${longest} ` })).toEqual({ title: longest });
	});
});
