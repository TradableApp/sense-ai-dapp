import GraphFetchFailed, { type GraphList } from '@/lib/graph/GraphFetchFailed';

/**
 * Which rows a page asks for, on a list ordered newest first by a BigInt key.
 *
 * `upTo` is the highest key wanted (`_lte`), null on the first page. `skip` is used only inside
 * a run of rows sharing one key that fills whole pages; otherwise it is 0.
 */
export interface KeysetWindow {
	readonly upTo: string | null;
	readonly skip: number;
}

export const FIRST_WINDOW: KeysetWindow = Object.freeze({ upTo: null, skip: 0 });

/**
 * The window after a full page, given the keys of its rows in order.
 *
 * The next page starts at the last row's key, inclusive, so rows sharing that key are not
 * missed; the ones already read come back and are dropped by id. That always moves on, because
 * a page whose keys differ holds fewer rows at its last key than a page holds. A page whose rows
 * all share one key would come back unchanged, so then the window stays on that key and skips
 * the rows read at it so far.
 */
export function nextWindow(window: KeysetWindow, keys: readonly string[]): KeysetWindow {
	const last = keys[keys.length - 1];
	const allAtLast = keys.every(key => key === last);
	if (!allAtLast) return { upTo: last, skip: 0 };
	// Rows at `last` before this page exist only if the previous window was already on it.
	const readBefore = window.upTo === last ? window.skip : 0;
	return { upTo: last, skip: readBefore + keys.length };
}

interface KeysetPagesInput<Row> {
	readonly list: GraphList;
	readonly pageSize: number;
	readonly keyOf: (_row: Row) => string;
	readonly idOf: (_row: Row) => string;
	readonly fetchPage: (_window: KeysetWindow) => Promise<readonly Row[]>;
	/** A page already in hand for `FIRST_WINDOW` (a nested list), so it is not asked for again. */
	readonly firstPage?: readonly Row[];
}

/**
 * Every row of a list, newest first, each once, read page by page until a page comes back
 * short.
 *
 * Paged by key rather than by `skip` alone: rows that change while paging move to a newer key,
 * above the window, so they do not shift the pages still to come; the next sync, which asks
 * from its cursor upwards, picks them up. Throws `GraphFetchFailed` (`no-progress`) when a full
 * page holds nothing new, which happens only when the endpoint ignores the window: asking again
 * would return the same page for ever.
 */
export async function collectKeysetPages<Row>({
	list,
	pageSize,
	keyOf,
	idOf,
	fetchPage,
	firstPage,
}: KeysetPagesInput<Row>): Promise<Row[]> {
	const seen = new Set<string>();
	let rows: Row[] = [];
	let window = FIRST_WINDOW;
	let page = firstPage ?? (await fetchPage(window));

	for (;;) {
		const fresh = page.filter(row => !seen.has(idOf(row)));
		fresh.forEach(row => seen.add(idOf(row)));
		rows = [...rows, ...fresh];

		if (page.length < pageSize) return rows;
		if (fresh.length === 0) throw new GraphFetchFailed(list, 'no-progress');

		window = nextWindow(window, page.map(keyOf));
		// eslint-disable-next-line no-await-in-loop -- each page's window comes from the one before
		page = await fetchPage(window);
	}
}
