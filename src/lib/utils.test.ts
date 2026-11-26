import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOSTILE_MARKDOWN } from '@/test/hostileMarkdown';

import { cn, copyMarkdownToClipboard, isObject, markdownToPlainText, wait } from './utils';

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
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves after the specified delay', async () => {
		const promise = wait(1000);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(promise).resolves.toBeUndefined();
	});

	it('returns a Promise<void>', async () => {
		const promise = wait(1);
		await vi.advanceTimersByTimeAsync(1);
		const result = await promise;
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

describe('copyMarkdownToClipboard', () => {
	// The rich copy is pasted into other apps (mail, documents), which load what its HTML names.
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function copiedHtml(markdown: string): Promise<HTMLElement> {
		const items: Array<Record<string, Blob>> = [];
		vi.stubGlobal(
			'ClipboardItem',
			class {
				constructor(parts: Record<string, Blob>) {
					items.push(parts);
				}
			},
		);
		vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => {}) } });

		expect(await copyMarkdownToClipboard(markdown)).toBe(true);
		const holder = document.createElement('div');
		holder.innerHTML = await items[0]['text/html'].text();
		return holder;
	}

	it('copies HTML that names no image or other resource, and only web links', async () => {
		const html = await copiedHtml(HOSTILE_MARKDOWN);

		expect(
			html.querySelectorAll('img, iframe, video, audio, source, object, embed, link'),
		).toHaveLength(0);
		// The image URLs are gone; the raw HTML lines stay as escaped text.
		['p.png', 'r.png', 'n.png'].forEach(file => expect(html.innerHTML).not.toContain(file));
		const hrefs = [...html.querySelectorAll('[href]')].map(el => el.getAttribute('href'));
		// The same links the chat shows for this text, the bare address included.
		expect(hrefs).toEqual([
			'https://news.example/n',
			'https://phish.example/claim',
			'http://www.bare.example/',
		]);
		expect(html.textContent).toContain('inline alt');
	});
});
