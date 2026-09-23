/**
 * Whether this build may install a Firebase App Check debug token.
 *
 * App Check is what stops anything other than the real app calling our Firebase backend. A debug
 * token is an explicit bypass: Firebase treats a request carrying a registered one as attested
 * without any attestation having happened. Firebase's own guidance is unambiguous — "do not ship
 * your debug token or debug build in production builds".
 *
 * TWO DEFECTS THIS GATE EXISTS TO CLOSE, both verified against real built bundles.
 *
 * 1. Vite INLINES `VITE_*` values, and inlines them as STRINGS. The env files set
 *    `VITE_APP_DEBUG=false`, which arrives in the bundle as the string "false" — and `"false"`
 *    is truthy. Every earlier version of this gate ended in `Boolean(dev || debugFlag)`, so a
 *    build that had explicitly turned debugging OFF turned it ON. A `build:testnet` bundle was
 *    confirmed to inline a real token and assign it to `window`.
 *
 * 2. Deciding by "is this mode production" put the question to a list that had to be kept
 *    correct forever, and testnet was not on it — but `build:testnet` is what feeds the
 *    `sense-ai-app-staging` and `sense-ai-app-dev` hosting targets in `.firebaserc`. It is a
 *    deployed artefact served to real browsers.
 *
 * So the question is not "which mode is this" but "is this a BUILD at all". `import.meta.env.DEV`
 * is true only under `vite dev` and is set by Vite itself, not by an env file — nothing in a
 * `.env` can forge it, which is exactly the property the old gate lacked. The dev server is the
 * one artefact that is never deployed anywhere; every build refuses, whatever its mode or flags.
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

/**
 * An explicit opt-OUT, compared by value rather than by truthiness.
 *
 * This is the comparison the first defect turned on: the env files set `VITE_APP_DEBUG=false`,
 * Vite inlines it as the string "false", and `Boolean("false")` is `true`. Anyone who wrote
 * `false` meant it, so it is matched literally.
 */
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
	// Checked FIRST and unconditionally. A build is an artefact someone can serve, so no mode and
	// no flag may opt one in. This is the line every earlier version of this gate lacked.
	if (!dev) return false;

	// Never bypass App Check against a production backend, even from a dev server.
	if (!DEBUGGABLE_MODES.includes(mode)) return false;

	// No token means there is nothing to install. The SDK ignores a non-string value
	// (@firebase/app-check checks `typeof … === 'string' || … === true`), so assigning undefined
	// was harmless rather than "debug requested" — but not assigning it at all is still clearer.
	if (!token) return false;

	// Under the dev server a token is the point, so an unset flag still enables it. Only an
	// explicit `VITE_APP_DEBUG=false` (or 0/no/off) turns it back off.
	return !isExplicitlyFalse(debugFlag);
}
