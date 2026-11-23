interface ActivityRow {
	id: string;
	type: string;
	timestamp: string;
}

const RETURN_SUFFIX = '-return';

/**
 * Puts each cancel immediately before the amount it hands back.
 *
 * A cancel writes two Activity rows in one transaction: CANCEL (id txHash-logIndex) and
 * CANCEL_RETURN (the same id plus "-return"). They share a timestamp, and The Graph orders by one
 * field only, so the subgraph gives the pair in whatever order its tie-break makes. A return row
 * whose CANCEL is in the same page, with the same timestamp, is moved to follow it; every other row
 * keeps the order given. A return whose cancel is not in the page (the page ended between them)
 * stays where it is. Returns a new array.
 */
export default function orderCancelPairs<T extends ActivityRow>(rows: readonly T[]): T[] {
	const returnOf = new Map<string, T>();
	rows.forEach(row => {
		if (row.type === 'CANCEL_RETURN' && row.id.endsWith(RETURN_SUFFIX)) {
			returnOf.set(row.id.slice(0, -RETURN_SUFFIX.length), row);
		}
	});
	// Given any row: the return that follows it, if the row is a CANCEL with its return in the page.
	const paired = (row: T): T | undefined => {
		const returned = returnOf.get(row.id);
		return row.type === 'CANCEL' && returned?.timestamp === row.timestamp ? returned : undefined;
	};
	const moved = new Set(rows.flatMap(row => paired(row) ?? []));

	return rows.flatMap(row => {
		if (moved.has(row)) return [];
		const returned = paired(row);
		return returned ? [row, returned] : [row];
	});
}
