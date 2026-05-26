import { describe, expect, it } from 'vitest';

import { cn, isObject, markdownToPlainText, wait } from './utils';

describe('cn', () => {
	it('merges class names', () => {
		expect(cn('px-2', 'py-4')).toBe('px-2 py-4');
	});

	it('handles conditional classes', () => {
		expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
	});

	it('handles undefined values', () => {
		expect(cn('base', undefined, 'extra')).toBe('base extra');
	});

	it('merges conflicting Tailwind classes (last wins)', () => {
		const result = cn('px-2', 'px-4');
		expect(result).toBe('px-4');
	});

	it('returns empty string for no inputs', () => {
		expect(cn()).toBe('');
	});
});

describe('wait', () => {
	it('resolves after the specified delay', async () => {
		const start = Date.now();
		await wait(50);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(40);
	});

	it('returns a Promise<void>', async () => {
		const result = await wait(1);
		expect(result).toBeUndefined();
	});
});

describe('isObject', () => {
	it('returns true for plain objects', () => {
		expect(isObject({})).toBe(true);
		expect(isObject({ key: 'value' })).toBe(true);
	});

	it('returns false for arrays', () => {
		expect(isObject([])).toBe(false);
	});

	it('returns false for null', () => {
		expect(isObject(null)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isObject('string')).toBe(false);
		expect(isObject(42)).toBe(false);
		expect(isObject(true)).toBe(false);
		expect(isObject(undefined)).toBe(false);
	});

	it('returns false for functions', () => {
		expect(isObject(() => {})).toBe(false);
	});

	it('returns false for Date instances', () => {
		expect(isObject(new Date())).toBe(false);
	});
});

describe('markdownToPlainText', () => {
	it('strips markdown formatting', () => {
		const result = markdownToPlainText('**bold** text');
		expect(result).toBe('bold text');
	});

	it('strips links', () => {
		const result = markdownToPlainText('[click here](https://example.com)');
		expect(result).toBe('click here');
	});

	it('handles headings', () => {
		const result = markdownToPlainText('# Title');
		expect(result).toBe('Title');
	});

	it('returns empty string for empty input', () => {
		expect(markdownToPlainText('')).toBe('');
	});

	it('trims whitespace', () => {
		const result = markdownToPlainText('  hello  ');
		expect(result).toBe('hello');
	});

	it('handles code blocks', () => {
		const result = markdownToPlainText('`inline code`');
		expect(result).toBe('inline code');
	});
});
