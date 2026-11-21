/**
 * Replaces what must never reach the error tracker: URLs, which can carry an RPC
 * provider's key in the host, path, query or user part, and long hex, which can be a wallet
 * address or call data. Used for the fee token check's report and for every breadcrumb.
 *
 * The cost is bounded, since it runs on every breadcrumb: at most `MAX_SCRUBBED` characters
 * are read, and each form may start only at the beginning of a run (a left boundary) with
 * bounded repeats, so no form rescans a long run of text from every position inside it.
 */

/** The most characters scrubbed from one piece of text; the rest is dropped. */
export const MAX_SCRUBBED = 2048;
/** Put where text was dropped, so a reader knows it was shortened. */
export const SHORTENED = '…[shortened]';

// Each form takes everything up to the next space with it, punctuation included: a key can
// sit in the path or the query, and a colon after it is not worth keeping a tail.
const HOST = '(?:localhost|[\\w-]{1,63}(?:\\.[\\w-]{1,63}){1,16})';
// A host form starts only where no host, user part or scheme character comes before it.
const HOST_START = '(?<![\\w.@+-])';
// A file name ending in a source extension, then `:line:column`.
const SOURCE_FRAME = '[\\w.-]{1,256}\\.(?:tsx?|jsx?|mjs|cjs|sol|css|json|html?):\\d+:\\d+';
const URL_FORMS = [
	// Any scheme (http, https, ws, wss), user part and IPv6 literals included.
	'(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\\/\\/\\S*',
	// An IPv6 literal, `[::1]` or `[2001:db8::7]`, with a port or path or neither. Two colons
	// at least, so an index or a slice such as `[0:2]` is left alone.
	'\\[[0-9a-f.]{0,39}:[0-9a-f.]{0,39}:[0-9a-f:.]{0,39}\\]\\S*',
	// A user part before a host with no scheme (`user:key@node.example.com`), starting after a
	// space, a quote or an opening bracket. It also takes an e-mail address, which is no loss.
	`(?<![^\\s"'(<\\[{,;=])[^\\s@/]{1,256}@${HOST}\\S*`,
	// A dotted host or localhost with a numeric port. The port must be a number, so "Error: 500"
	// or "timeout: 30" is left alone.
	// A source file with its line and column ("at Chat.tsx:42:13") is a stack frame, not a
	// host, and is kept.
	`${HOST_START}(?!${SOURCE_FRAME})${HOST}:\\d{1,5}(?!\\d)\\S*`,
	// A dotted host or localhost followed by a path, or by a query with something in it. This
	// also takes a dotted name before a slash that is no host (a file path such as
	// "Token.sol/transfer"): losing that is the price of never keeping a URL. A question mark
	// with nothing after it ends a sentence and is left alone.
	`${HOST_START}${HOST}(?:[/#]\\S*|\\?\\S+)`,
];
const URL_PATTERN = new RegExp(URL_FORMS.join('|'), 'gi');

// 0x or 0X and nine or more hex digits, or sixteen or more hex digits with no letter or
// digit on either side (an underscore before them, as in `key_<hex>`, does not hide them).
// Exactly eight after 0x is a four-byte error selector, which is how a token's error reaches
// the app from a public node: it says which error it was and is kept.
const LONG_HEX = /0x[0-9a-f]{9,}|(?<![0-9a-z])[0-9a-f]{16,}(?![0-9a-z])/gi;

/**
 * Escaped forms written back plainly, so the URL forms see them: JSON-escaped slashes, and
 * the percent-encoded colon, slash and at sign. Plain replacements, so a malformed percent
 * sequence is left as it is and nothing can throw. The text only gets shorter, so the
 * length bound still holds.
 */
const unescape = (text: string): string =>
	text.replace(/\\\//g, '/').replace(/%3a/gi, ':').replace(/%2f/gi, '/').replace(/%40/gi, '@');

/**
 * The first `MAX_SCRUBBED` characters, and whether anything was dropped. A cut can fall
 * inside a URL that no longer looks like one once cut, so the piece the cut falls in is
 * dropped too, back to the last space.
 */
function bounded(text: string): { head: string; isCut: boolean } {
	if (text.length <= MAX_SCRUBBED) return { head: text, isCut: false };
	const head = text.slice(0, MAX_SCRUBBED);
	let end = head.length;
	while (end > 0 && !/\s/.test(head[end - 1])) end -= 1;
	return { head: head.slice(0, end), isCut: true };
}

/** The text with every URL replaced by `<url>` and every long hex by `<hex>`, on every line. */
export default function scrubSecrets(text: string): string {
	const { head, isCut } = bounded(text);
	const scrubbed = unescape(head).replace(URL_PATTERN, '<url>').replace(LONG_HEX, '<hex>');
	return isCut ? `${scrubbed}${SHORTENED}` : scrubbed;
}
