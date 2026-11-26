/**
 * How many quotes and lists one line may open, one inside the other, and still be rendered as
 * markdown. Writing by hand never comes near it; the renderer handles each level by calling
 * itself, and its time and its stack grow with the depth.
 */
export const MAX_NESTING = 64;

const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const QUOTE = 0x3e;
const LIST_MARKERS = new Set([0x2d, 0x2a, 0x2b]); // - * +

/**
 * Whether a line of the text opens more than `MAX_NESTING` quotes and lists at its start: `>`
 * markers, and `-`, `*` or `+` followed by a space. Such text is shown as written and never
 * handed to the renderer. One pass over the text; a line stops being counted at its first
 * character that is none of these, so a long rule (`-----`) or a `>` inside a sentence opens
 * nothing.
 */
export function isNestedTooDeep(text: string): boolean {
	let depth = 0;
	let counting = true;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code === LINE_FEED) {
			depth = 0;
			counting = true;
		} else if (counting && code !== SPACE && code !== TAB) {
			const next = text.charCodeAt(index + 1);
			const opensList = LIST_MARKERS.has(code) && (next === SPACE || next === TAB);
			if (code === QUOTE || opensList) {
				depth += 1;
				if (depth > MAX_NESTING) return true;
			} else {
				counting = false;
			}
		}
	}

	return false;
}
