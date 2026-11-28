import { MAX_TITLE_CHARS } from '@/features/history/renameSchema';

/**
 * The title a branch sends for the conversation it comes from: at most `MAX_TITLE_CHARS`
 * code units, as the oracle counts them. A conversation's own title can be longer (a branch
 * of a branch is titled "Branch of" its origin's title). A cut never splits a character in
 * two: when the last code unit kept is the first half of a pair, it is dropped too.
 */
export default function branchTitle(title: string): string {
	if (title.length <= MAX_TITLE_CHARS) return title;
	const cut = title.slice(0, MAX_TITLE_CHARS);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
