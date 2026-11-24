/**
 * Reasoning steps and sources carry the attempt that produced them: 1 for the first provider
 * tried, one more for each fallback the oracle entered. The attempt that answered is current;
 * lower ones are shown as "Earlier attempt". An item stored before attempts were recorded has
 * none and belongs to attempt 1.
 *
 * The stored answer file says which attempt answered in `answerAttempt` (written by an oracle
 * that records attempts), so a fallback that answered with no steps or sources of its own still
 * puts the failed attempt's items under "Earlier attempt". A file without it (or with anything
 * but a positive safe integer there) falls back to the highest attempt among its items.
 */
export interface HasAttempt {
	attempt?: number;
}

export const attemptOf = (item: HasAttempt): number => item.attempt ?? 1;

/** The attempt shown as current: the highest present, or `atLeast` when that is higher. */
export const currentAttemptOf = (items: readonly HasAttempt[], atLeast = 1): number =>
	items.reduce((highest, item) => Math.max(highest, attemptOf(item)), Math.max(atLeast, 1));

/** A stored `answerAttempt`, when it is a positive safe integer; anything else is no value. */
export const storedAnswerAttempt = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined;

/** A decrypted answer file with an `answerAttempt` this build cannot use left out (a new object). */
export function withCheckedAnswerAttempt<T extends Record<string, unknown>>(file: T): T {
	if (!('answerAttempt' in file) || storedAnswerAttempt(file.answerAttempt) !== undefined) {
		return file;
	}
	const { answerAttempt: _ignored, ...rest } = file;
	return rest as T;
}

/** The current attempt of a stored answer: the one its record says answered, else the highest. */
export const storedCurrentAttempt = (
	items: readonly HasAttempt[],
	answerAttempt: unknown,
): number => currentAttemptOf(items, storedAnswerAttempt(answerAttempt));

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
