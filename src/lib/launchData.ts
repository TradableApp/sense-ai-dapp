/**
 * Telegram opens the dApp as a Mini App with launch parameters in the page URL, each named
 * `tgWebApp…` (`tgWebAppData` carries the Telegram user and a signed hash). Analytics and error
 * reports copy the page URL, so `withoutLaunchData` gives a URL back without them.
 *
 * Every parameter whose name, once percent-decoded, starts with `tgWebApp` is removed from the
 * query and from the fragment; the others are kept in their order, and a query or fragment left
 * empty is removed with its `?` or `#`. A URL is an absolute URL (`scheme://…`) or a reference
 * relative to the page (starting with `/`, `?` or `#`), with no white space. A URL with no launch
 * parameter, and any other string, is returned unchanged.
 */

const LAUNCH_PARAMETER = /^tgWebApp/;
const URL_SHAPED = /^(?:[a-z][a-z0-9+.-]*:\/\/|[/?#])\S*$/i;

/** A parameter's name, percent-decoded; as written when it cannot be decoded. */
function nameOf(parameter: string): string {
	const name = parameter.split('=', 1)[0] ?? '';
	try {
		return decodeURIComponent(name.replace(/\+/g, ' '));
	} catch {
		return name;
	}
}

/** The parameters given, without the launch parameters; the same string when there are none. */
function withoutLaunchParameters(parameters: string): string {
	const all = parameters.split('&');
	const kept = all.filter(parameter => !LAUNCH_PARAMETER.test(nameOf(parameter)));
	return kept.length === all.length ? parameters : kept.join('&');
}

export default function withoutLaunchData(value: string): string {
	if (!URL_SHAPED.test(value)) return value;

	const hashAt = value.indexOf('#');
	const beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
	const fragment = hashAt === -1 ? null : value.slice(hashAt + 1);
	const queryAt = beforeHash.indexOf('?');
	const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
	const query = queryAt === -1 ? null : beforeHash.slice(queryAt + 1);

	const keptQuery = query === null ? null : withoutLaunchParameters(query);
	const keptFragment = fragment === null ? null : withoutLaunchParameters(fragment);
	if (keptQuery === query && keptFragment === fragment) return value;

	return `${base}${keptQuery ? `?${keptQuery}` : ''}${keptFragment ? `#${keptFragment}` : ''}`;
}
