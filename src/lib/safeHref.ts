const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The URL as the browser reads it, when it is an absolute http or https URL; otherwise null.
 * Every URL from conversation text that becomes an `href` goes through this: a markdown link in
 * a prompt or an answer, and a source from a decrypted frame or a stored answer file. Anything
 * else (`javascript:`, `data:`, `blob:`, `mailto:`, another scheme) must never be clickable.
 * `URL` lower-cases the scheme and drops surrounding spaces and control characters and any tab
 * or line break, so `JaVaScRiPt:`, ` javascript:` and `java<tab>script:` are refused too; a
 * relative or protocol-relative URL (`/a`, `//host`, `/\host`) does not parse without a base and
 * is refused. What is given back is the parsed form, so the link is exactly the URL checked.
 */
export default function safeHref(url: string | null | undefined): string | null {
	if (typeof url !== 'string' || url === '') return null;
	try {
		const parsed = new URL(url);
		return WEB_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
	} catch {
		return null;
	}
}

/**
 * The URL a link made from conversation text may lead to: one `safeHref` accepts that carries
 * no user name or password. `https://bank.example@other.example/` goes to `other.example`, and
 * a reader takes the part before the `@` for the site, so such a URL is never a link.
 */
export function linkHref(url: string | null | undefined): string | null {
	const href = safeHref(url);
	if (!href) return null;
	const { username, password } = new URL(href);
	return username === '' && password === '' ? href : null;
}

/**
 * Whether a link's own text already shows where it leads: the text, as written, is the host the
 * browser will open or a URL on it. A host with a punycode label is never taken as shown: text
 * in look-alike letters reads as another site, so the host is shown as the browser reads it.
 */
export function textShowsHost(text: string, href: string): boolean {
	const { host, protocol } = new URL(href);
	if (host.split('.').some(label => label.startsWith('xn--'))) return false;
	const shown = text.trim().toLowerCase();
	if (shown === host) return true;
	return [`${protocol}//${host}`, host].some(
		start => shown.startsWith(start) && /^[/?#]/.test(shown.slice(start.length)),
	);
}
