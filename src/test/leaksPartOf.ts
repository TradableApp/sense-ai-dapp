/**
 * Whether `message` repeats any four characters in a row of `value`. A setting refused by
 * the build may be a secret pasted into the wrong place, and its message is printed to a
 * terminal or a CI log, so not even a short piece of it may appear.
 */
export const LEAK_WINDOW = 4;

export default function leaksPartOf(message: string, value: string): boolean {
	// A shorter value has no window to look for and would pass any message.
	if (value.length < LEAK_WINDOW) {
		throw new Error(`leaksPartOf needs a value of at least ${LEAK_WINDOW} characters.`);
	}
	return Array.from({ length: value.length - LEAK_WINDOW + 1 }, (_, i) =>
		value.slice(i, i + LEAK_WINDOW),
	).some(part => message.includes(part));
}
