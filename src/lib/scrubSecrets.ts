/**
 * Replaces what must never reach the error tracker: URLs, which can carry an RPC
 * provider's key in the host, path, query or user part, and long hex, which can be a wallet
 * address or call data. Used for the fee token check's report and for every breadcrumb.
 */

// Each alternative takes everything up to the next space with it, punctuation included: a
// key can sit in the path or the query, and a colon after it is not worth keeping a tail.
const URL_FORMS = [
	// Any scheme (http, https, ws, wss), user part and IPv6 literals included.
	'[a-z][a-z0-9+.-]*:\\/\\/\\S+',
	// An IPv6 literal, `[::1]` or `[2001:db8::7]`, with a port or path or neither. Two colons
	// at least, so an index or a slice such as `[0:2]` is left alone.
	'\\[[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*\\]\\S*',
	// A user part before a host with no scheme (`user:key@node.example.com`). It also takes an
	// e-mail address, which is no loss in a report.
	'[^\\s@/]+@(?:localhost|[\\w-]+(?:\\.[\\w-]+)+)\\S*',
	// A dotted host or localhost with a numeric port. The port must be a number, so "Error: 500"
	// or "timeout: 30" is left alone.
	'\\b(?:localhost|[\\w-]+(?:\\.[\\w-]+)+):\\d{1,5}(?!\\d)\\S*',
	// A dotted host or localhost followed by a path, or by a query with something in it. This
	// also takes a dotted name before a slash that is no host (a file path such as
	// "Token.sol/transfer"): losing that is the price of never keeping a URL. A question mark
	// with nothing after it ends a sentence and is left alone.
	'\\b(?:localhost|[\\w-]+(?:\\.[\\w-]+)+)(?:[/#]\\S*|\\?\\S+)',
];
const URL_PATTERN = new RegExp(URL_FORMS.join('|'), 'gi');

// 0x or 0X and eight or more hex digits, or sixteen or more hex digits on their own.
const LONG_HEX = /0x[0-9a-f]{8,}|\b[0-9a-f]{16,}\b/gi;

/** The text with every URL replaced by `<url>` and every long hex by `<hex>`, on every line. */
export default function scrubSecrets(text: string): string {
	return text.replace(URL_PATTERN, '<url>').replace(LONG_HEX, '<hex>');
}
