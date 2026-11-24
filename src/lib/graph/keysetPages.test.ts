import { describe, expect, it, vi } from 'vitest';

import GraphFetchFailed from '@/lib/graph/GraphFetchFailed';
import {
	collectKeysetPages,
	FIRST_WINDOW,
	MAX_KEYSET_PAGES,
	nextWindow,
} from '@/lib/graph/keysetPages';

describe('nextWindow', () => {
	it('starts the next page at the last key, from its first row, when the keys differ', () => {
		expect(nextWindow(FIRST_WINDOW, ['9', '8', '8'])).toEqual({ upTo: '8', skip: 0 });
	});

	it('skips the rows read at one key when a whole page shares it', () => {
		expect(nextWindow(FIRST_WINDOW, ['5', '5', '5'])).toEqual({ upTo: '5', skip: 3 });
		// The second page at that key adds its rows to those already skipped.
		expect(nextWindow({ upTo: '5', skip: 3 }, ['5', '5', '5'])).toEqual({ upTo: '5', skip: 6 });
	});

	it('counts from nothing when a whole page shares a key the window was not on', () => {
		// The run at 5 ended exactly at the page edge; nothing at 4 was read before.
		expect(nextWindow({ upTo: '5', skip: 3 }, ['4', '4', '4'])).toEqual({ upTo: '4', skip: 3 });
	});

	it('leaves a run once a page reaches past it', () => {
		expect(nextWindow({ upTo: '5', skip: 3 }, ['5', '4', '3'])).toEqual({ upTo: '3', skip: 0 });
	});
});

describe('collectKeysetPages', () => {
	const row = (id: string, key: string) => ({ id, key });

	it('asks once when the first page is short', async () => {
		const fetchPage = vi.fn(async () => [row('a', '2'), row('b', '1')]);

		const rows = await collectKeysetPages({
			list: 'conversations',
			pageSize: 3,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
		});

		expect(rows.map(r => r.id)).toEqual(['a', 'b']);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('uses a page already in hand without asking for it', async () => {
		const fetchPage = vi.fn(async () => [row('c', '2'), row('d', '1')]);

		const rows = await collectKeysetPages({
			list: 'messages',
			pageSize: 3,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
			firstPage: [row('a', '4'), row('b', '3'), row('c', '2')],
		});

		// c came back on the second page and is kept once.
		expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(fetchPage).toHaveBeenCalledWith({ upTo: '2', skip: 0 });
	});

	it('throws instead of asking for ever when a full page holds nothing new', async () => {
		const page = [row('a', '3'), row('b', '2'), row('c', '1')];
		const fetchPage = vi.fn(async () => page);

		const collecting = collectKeysetPages({
			list: 'conversations',
			pageSize: 3,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
		});

		await expect(collecting).rejects.toBeInstanceOf(GraphFetchFailed);
		await expect(collecting).rejects.toMatchObject({ reason: 'no-progress' });
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});
});

describe('collectKeysetPages — the page cap', () => {
	const row = (id: string, key: string) => ({ id, key });

	// Where the fake endpoint gives in with a short page, so a missing cap fails the test
	// rather than running until the test runner runs out of memory.
	const TEST_STOP = 20_000;

	/** Full pages of two, each with one row not read before (`next`) and one repeat. */
	function endlessPages() {
		let next = 0;
		return vi.fn(async () => {
			next += 1;
			if (next > TEST_STOP) return [];
			return [row(`new-${next}`, '5'), row('repeat', '5')];
		});
	}

	it('stops a list whose pages never come back short, after the cap, with its own reason', async () => {
		const fetchPage = endlessPages();

		const collecting = collectKeysetPages({
			list: 'conversations',
			pageSize: 2,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
		});

		await expect(collecting).rejects.toBeInstanceOf(GraphFetchFailed);
		await expect(collecting).rejects.toMatchObject({
			list: 'conversations',
			reason: 'too-many-pages',
		});
		expect(fetchPage).toHaveBeenCalledTimes(MAX_KEYSET_PAGES);
	});

	it('counts a page already in hand as one of them', async () => {
		const fetchPage = endlessPages();

		const collecting = collectKeysetPages({
			list: 'messages',
			pageSize: 2,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
			firstPage: [row('first', '5'), row('repeat', '5')],
		});

		await expect(collecting).rejects.toMatchObject({ reason: 'too-many-pages' });
		expect(fetchPage).toHaveBeenCalledTimes(MAX_KEYSET_PAGES - 1);
	});

	it('reads a list of exactly the cap in pages, the last one short', async () => {
		let asked = 0;
		const fetchPage = vi.fn(async () => {
			asked += 1;
			return asked < MAX_KEYSET_PAGES
				? [row(`a-${asked}`, String(10_000 - asked)), row(`b-${asked}`, String(10_000 - asked))]
				: [row('last', '1')];
		});

		const rows = await collectKeysetPages({
			list: 'conversations',
			pageSize: 2,
			keyOf: r => r.key,
			idOf: r => r.id,
			fetchPage,
		});

		expect(fetchPage).toHaveBeenCalledTimes(MAX_KEYSET_PAGES);
		expect(rows).toHaveLength(2 * (MAX_KEYSET_PAGES - 1) + 1);
	});
});
