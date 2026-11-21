// Kept free of imports but this one, so `vite.config.ts` can load it before the `@/` alias exists.
import describeShape from '../lib/settingShape';

/** How the dApp reads the stream: one long response per connection, or one short response per poll. */
export const REASONING_STREAM_MODES = ['sse', 'poll'] as const;
export type ReasoningStreamMode = (typeof REASONING_STREAM_MODES)[number];

export interface ReasoningStreamSetting {
	url: string;
	mode: ReasoningStreamMode;
}

/** The build names a reasoning stream it cannot use. */
export class ReasoningStreamConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReasoningStreamConfigError';
	}
}

/** Modes whose stream may be plain http on a loopback host: the e2e stack's and the unit tests'. */
const MODES_WITH_LOOPBACK_HTTP = ['localnet', 'test'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * True for an origin with an optional path and nothing else: no trailing slash, no query, no
 * fragment, no user or password. `https:`, or `http:` on a loopback host where allowed.
 */
function isStreamUrl(value: string, mode: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	const path = url.pathname === '/' ? '' : url.pathname;
	if (value !== `${url.origin}${path}` || value.endsWith('/')) return false;
	if (url.protocol === 'https:') return true;
	return (
		url.protocol === 'http:' &&
		MODES_WITH_LOOPBACK_HTTP.includes(mode) &&
		LOOPBACK_HOSTS.includes(url.hostname)
	);
}

/**
 * The stream this build reads, or null when `VITE_REASONING_STREAM_URL` is unset or empty (the
 * stream is off and the chat works as it always has). Throws for a value it cannot use; the
 * message describes the value by its shape only, since it is printed to a terminal or a CI log.
 */
export function parseReasoningStreamSetting(
	mode: string,
	env: Record<string, string | undefined>,
): ReasoningStreamSetting | null {
	const url = env.VITE_REASONING_STREAM_URL ?? '';
	if (url === '') return null;
	if (!isStreamUrl(url, mode)) {
		throw new ReasoningStreamConfigError(
			`VITE_REASONING_STREAM_URL must be an https origin with an optional path and no trailing slash, query or fragment (plain http only for a loopback host on localnet) for a ${mode} build; got ${describeShape(
				url,
			)}.`,
		);
	}
	const streamMode = env.VITE_REASONING_STREAM_MODE || 'sse';
	if (!(REASONING_STREAM_MODES as readonly string[]).includes(streamMode)) {
		throw new ReasoningStreamConfigError(
			`VITE_REASONING_STREAM_MODE must be one of ${REASONING_STREAM_MODES.join(
				', ',
			)} or unset; got ${describeShape(streamMode)}.`,
		);
	}
	return { url, mode: streamMode as ReasoningStreamMode };
}

/** Stops a build or dev server whose reasoning stream setting is malformed. Called from `vite.config.ts`. */
export function assertReasoningStreamConfig(
	mode: string,
	env: Record<string, string | undefined>,
): void {
	parseReasoningStreamSetting(mode, env);
}
