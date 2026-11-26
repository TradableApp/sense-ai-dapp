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
