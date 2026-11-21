/**
 * Reasoning steps and sources carry the attempt that produced them: 1 for the first provider
 * tried, one more for each fallback the oracle entered. The last attempt is the one that
 * answered; lower ones are shown as "Earlier attempt". An item stored before attempts were
 * recorded has none and belongs to attempt 1.
 */
export interface HasAttempt {
	attempt?: number;
}

export const attemptOf = (item: HasAttempt): number => item.attempt ?? 1;

/** The attempt shown as current: the highest present, or `atLeast` when that is higher. */
export const currentAttemptOf = (items: readonly HasAttempt[], atLeast = 1): number =>
	items.reduce((highest, item) => Math.max(highest, attemptOf(item)), Math.max(atLeast, 1));

/** Items with their position in the full list, split into earlier attempts and the current one. */
export function splitByAttempt<T extends HasAttempt>(
	items: readonly T[],
	current: number,
): { earlier: Array<{ item: T; index: number }>; latest: Array<{ item: T; index: number }> } {
	const indexed = items.map((item, index) => ({ item, index }));
	return {
		earlier: indexed.filter(({ item }) => attemptOf(item) < current),
		latest: indexed.filter(({ item }) => attemptOf(item) >= current),
	};
}
