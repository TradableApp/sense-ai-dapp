/**
 * Whether this build may install a Firebase App Check debug token.
 *
 * A debug token is an explicit bypass: Firebase treats a request carrying a registered one as
 * attested without any attestation happening. Firebase's guidance is "do not ship your debug
 * token or debug build in production builds".
 *
 * Two verified defects this gate closes:
 *
 * 1. Vite inlines `VITE_*` values as STRINGS. The env files set `VITE_APP_DEBUG=false`, which
 *    reaches the bundle as `"false"` — truthy. Earlier versions ended in
 *    `Boolean(dev || debugFlag)`, so a build with debugging explicitly OFF turned it ON. A
 *    `build:testnet` bundle was confirmed to inline a real token and assign it to `window`.
 *
 * 2. Gating on "is this mode production" needed a list kept correct forever, and testnet was not
 *    on it — yet `build:testnet` feeds the `sense-ai-app-staging` and `sense-ai-app-dev` hosting
 *    targets in `.firebaserc`, served to real browsers.
 *
 * So the test is not "which mode" but "is this a BUILD at all". `import.meta.env.DEV` is true
 * only under `vite dev` and is set by Vite, not by an env file, so nothing in a `.env` can forge
 * it — the property the old gate lacked.
 */

export interface AppCheckDebugEnv {
	/** `import.meta.env.DEV` — true only under the dev server. Set by Vite, not by any env file. */
	dev: boolean;
	/** `import.meta.env.MODE` — the Vite build mode; decides which BACKEND may be bypassed. */
	mode: string;
	/** `import.meta.env.VITE_APP_DEBUG` — arrives as a STRING when set through an env file. */
	debugFlag: string | boolean | undefined;
	/** `import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN` */
	token: string | undefined;
}

/** Explicit opt-out, compared by VALUE — see defect 1 above; `Boolean("false")` is true. */
function isExplicitlyFalse(flag: string | boolean | undefined): boolean {
	return (
		flag === false ||
		(typeof flag === 'string' && ['false', '0', 'no', 'off'].includes(flag.trim().toLowerCase()))
	);
}

/**
 * The only modes whose Firebase backend may be reached with a bypass token.
 *
 * An allowlist, so an unrecognised mode fails CLOSED. This is a second, independent condition
 * from the `dev` check: `dev` decides whether the artefact can be deployed, this decides which
 * BACKEND it may bypass. `vite dev --mode mainnet` is a dev server — never deployed — but it
 * talks to production Firebase, and a debug token there would bypass App Check on the real
 * backend. Both conditions are needed; neither implies the other.
 */
const DEBUGGABLE_MODES = ['development', 'localnet', 'testnet'];

export function shouldUseAppCheckDebugToken({
	dev,
	mode,
	debugFlag,
	token,
}: AppCheckDebugEnv): boolean {
	// First and unconditional: a build is an artefact someone can serve, so no mode and no flag
	// may opt one in.
	if (!dev) return false;
	if (!DEBUGGABLE_MODES.includes(mode)) return false;
	if (!token) return false;

	// Under the dev server a token is the point, so an unset flag still enables it.
	return !isExplicitlyFalse(debugFlag);
}
