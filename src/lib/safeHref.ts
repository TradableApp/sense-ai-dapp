const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The URL, when it is an absolute http or https URL; otherwise null. Every source URL that
 * becomes an `href` goes through this: it comes from a decrypted frame or a stored answer file,
 * and a `javascript:`, `data:` or other scheme must never be clickable. `URL` lower-cases the
 * scheme and trims surrounding spaces, so `JaVaScRiPt:` and ` javascript:` are refused too; a
 * relative path does not parse without a base and is refused.
 */
export default function safeHref(url: string | null | undefined): string | null {
	if (typeof url !== 'string' || url === '') return null;
	try {
		return WEB_PROTOCOLS.has(new URL(url).protocol) ? url : null;
	} catch {
		return null;
	}
}
