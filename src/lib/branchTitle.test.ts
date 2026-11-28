import { describe, expect, it } from 'vitest';

import { MAX_TITLE_CHARS } from '@/features/history/renameSchema';

import branchTitle from './branchTitle';

describe('branchTitle', () => {
	it('is the rename limit of 100', () => {
		expect(MAX_TITLE_CHARS).toBe(100);
	});

	it('leaves a short title as it is', () => {
		expect(branchTitle('Market outlook')).toBe('Market outlook');
	});

	it('leaves a title of exactly the limit as it is', () => {
		const title = 'a'.repeat(MAX_TITLE_CHARS);
		expect(branchTitle(title)).toBe(title);
	});

	it.each([1, 50])('cuts a title %i over the limit to the limit', over => {
		const title = `Branch of ${'a'.repeat(MAX_TITLE_CHARS + over)}`;
		expect(branchTitle(title)).toBe(title.slice(0, MAX_TITLE_CHARS));
	});

	it('cuts before a character whose two halves straddle the limit', () => {
		// The 100th and 101st code units are one character's two halves.
		const title = `${'a'.repeat(MAX_TITLE_CHARS - 1)}\u{1F600}tail`;
		expect(branchTitle(title)).toBe('a'.repeat(MAX_TITLE_CHARS - 1));
	});

	it('keeps a character that ends exactly at the limit', () => {
		const title = `${'a'.repeat(MAX_TITLE_CHARS - 2)}\u{1F600}tail`;
		expect(branchTitle(title)).toBe(`${'a'.repeat(MAX_TITLE_CHARS - 2)}\u{1F600}`);
	});
});
