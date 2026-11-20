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
