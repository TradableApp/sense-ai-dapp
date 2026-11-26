import { describe, expect, it } from 'vitest';

import { isNestedTooDeep, MAX_NESTING } from './markdownDepth';

describe('isNestedTooDeep', () => {
	it('is false for ordinary text, quotes and lists', () => {
		expect(isNestedTooDeep('plain text')).toBe(false);
		expect(isNestedTooDeep('> a quote\n> > inside it\n- a list\n  - inside it')).toBe(false);
		expect(isNestedTooDeep('')).toBe(false);
	});

	it('counts quote markers at the start of a line, with or without spaces', () => {
		expect(isNestedTooDeep(`${'>'.repeat(MAX_NESTING)} at the limit`)).toBe(false);
		expect(isNestedTooDeep(`${'>'.repeat(MAX_NESTING + 1)} over it`)).toBe(true);
		expect(isNestedTooDeep(`${'> '.repeat(MAX_NESTING + 1)}over it`)).toBe(true);
	});

	it('counts list markers the same way, and a mix of the two', () => {
		expect(isNestedTooDeep(`${'- '.repeat(MAX_NESTING + 1)}item`)).toBe(true);
		expect(isNestedTooDeep(`${'> - '.repeat(MAX_NESTING / 2 + 1)}item`)).toBe(true);
	});

	it('finds a deep line anywhere in the text', () => {
		expect(isNestedTooDeep(`first line\n\n${'>'.repeat(20000)} deep\nlast line`)).toBe(true);
	});

	it('is false for a long rule or a line of markers that nest nothing', () => {
		expect(isNestedTooDeep('-'.repeat(200))).toBe(false);
		expect(isNestedTooDeep('*'.repeat(200))).toBe(false);
		expect(isNestedTooDeep(`a ${'>'.repeat(200)} b`)).toBe(false);
	});
});
