import { describe, expect, it } from 'vitest';

import { scrubBreadcrumb } from '@/config/sentry';
import { describeFailure } from '@/lib/feeTokenCheckFailure';
import scrubSecrets, { MAX_SCRUBBED, SHORTENED } from '@/lib/scrubSecrets';

// Text that matches nothing but used to make the URL rule rescan the rest of the run from
// every position: about 100 KB each, as a hostile or broken console line could be.
const SIZE = 100_000;
const HOSTILE: [string, string][] = [
	['a long run of one letter', 'a'.repeat(SIZE)],
	['a long dotted run', 'a.'.repeat(SIZE / 2)],
	['a long run of user parts', 'a@'.repeat(SIZE / 2)],
	['a long scheme-like run with no ://', '+-'.repeat(SIZE / 2)],
];
// Generous: a bounded scrub takes a few milliseconds; the unbounded one took seconds.
const BOUND_MS = 200;

const elapsed = (run: () => unknown): number => {
	const start = performance.now();
	run();
	return performance.now() - start;
};

describe('scrubbing hostile text takes bounded time', () => {
	it.each(HOSTILE)('scrubSecrets on %s', (_label, text) => {
		expect(elapsed(() => scrubSecrets(text))).toBeLessThan(BOUND_MS);
	});

	it.each(HOSTILE)('the fee token report on %s', (_label, text) => {
		expect(elapsed(() => describeFailure(new Error(text)))).toBeLessThan(BOUND_MS);
	});

	it.each(HOSTILE)('a breadcrumb message and URL on %s', (_label, text) => {
		const breadcrumb = { category: 'fetch', message: text, data: { url: text } };

		expect(elapsed(() => scrubBreadcrumb(breadcrumb))).toBeLessThan(BOUND_MS);
	});
});

describe('text past the cap', () => {
	it('is dropped, and the cut is marked', () => {
		const text = `${'word '.repeat(MAX_SCRUBBED)}https://node.example/v2/KEY123`;

		const scrubbed = scrubSecrets(text);

		expect(scrubbed).not.toContain('KEY123');
		expect(scrubbed).not.toContain('node.example');
		expect(scrubbed.endsWith(SHORTENED)).toBe(true);
		expect(scrubbed.length).toBeLessThanOrEqual(MAX_SCRUBBED + SHORTENED.length);
	});

	it('drops a URL the cut falls inside, which would no longer look like one', () => {
		const url = 'node.example.com/v2/KEY123';
		// The cut falls after "node.exa", which on its own is no URL.
		const text = `${'w'.repeat(MAX_SCRUBBED - 9)} ${url}`;

		const scrubbed = scrubSecrets(text);

		expect(scrubbed).not.toContain('node');
		expect(scrubbed).not.toContain('KEY123');
		expect(scrubbed.endsWith(SHORTENED)).toBe(true);
	});

	it('leaves text within the cap whole and unmarked', () => {
		const text = 'refused by node.example.com/v2/KEY123 now';

		expect(scrubSecrets(text)).toBe('refused by <url> now');
	});
});

describe('what the scrub keeps and catches', () => {
	// A token's error reaches the app from a public node as a bare selector, four bytes:
	// keeping it is how a report says which error it was.
	it('keeps a bare four-byte error selector', () => {
		expect(scrubSecrets('Encoded error signature "0xfb8f41b2" not found on ABI.')).toBe(
			'Encoded error signature "0xfb8f41b2" not found on ABI.',
		);
	});

	it('replaces 0x and nine or more hex digits', () => {
		expect(scrubSecrets('data 0xfb8f41b2a and 0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe(
			'data <hex> and <hex>',
		);
	});

	it('replaces long hex glued to a name by an underscore', () => {
		const key = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';

		expect(scrubSecrets(`key_${key} rejected`)).toBe('key_<hex> rejected');
	});

	it.each([
		['JSON-escaped slashes', '{"url":"https:\\/\\/node.example\\/v2\\/KEY123"}', '{"url":"<url>'],
		['percent-encoded', 'from https%3A%2F%2Fnode.example%2Fv2%2FKEY123 now', 'from <url> now'],
		[
			'percent-encoded in lower case',
			'from https%3a%2f%2fnode.example%2fv2%2fKEY123',
			'from <url>',
		],
	])('replaces a URL written with %s', (_label, text, expected) => {
		const scrubbed = scrubSecrets(text);

		expect(scrubbed).not.toContain('KEY123');
		expect(scrubbed).toBe(expected);
	});

	it('does not throw on a malformed percent sequence', () => {
		expect(() => scrubSecrets('100%zz done %E0%A4%A')).not.toThrow();
	});

	it.each([
		'at Chat.tsx:42:13',
		'at useChatMutations (useChatMutations.ts:120:7)',
		'compiled from Token.sol:88:4',
	])('keeps a source file with its line and column in %j', text => {
		expect(scrubSecrets(text)).toBe(text);
	});

	it('still replaces a host and port that is not a source file', () => {
		expect(scrubSecrets('connect refused node.example.com:8545:1 now')).toBe(
			'connect refused <url> now',
		);
	});
});
