/**
 * Whether this build may install a Firebase App Check debug token.
 *
 * App Check is what stops anything other than the real app calling our Firebase backend. A debug
 * token is an explicit bypass: Firebase treats a request carrying a registered one as attested
 * without any attestation having happened.
 *
 * The previous gate was `import.meta.env.DEV || import.meta.env.VITE_APP_DEBUG`. `DEV` is false
 * in every build, so the whole decision rested on an ordinary env var — and Vite INLINES
 * `VITE_*` values at build time. A production build made with it set therefore shipped a
 * permanent App Check bypass to every user, with the token itself readable in the bundle by
 * anyone who cared to look, and reusable from anywhere.
 *
 * So production is decided by the BUILD MODE, which is set by the build script rather than by
 * the environment, and no flag can override it.
 */

/** Build modes that must never carry a debug token, whatever else is set. */
const PRODUCTION_MODES = ['production', 'mainnet'];

export interface AppCheckDebugEnv {
	/** `import.meta.env.DEV` */
	dev: boolean;
	/** `import.meta.env.MODE` — the Vite build mode. */
	mode: string;
	/** `import.meta.env.VITE_APP_DEBUG` */
	debugFlag: string | boolean | undefined;
	/** `import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN` */
	token: string | undefined;
}

export function shouldUseAppCheckDebugToken({
	dev,
	mode,
	debugFlag,
	token,
}: AppCheckDebugEnv): boolean {
	// Checked FIRST and unconditionally: a production build is never eligible, even if DEV is
	// somehow true. This is the line the old gate did not have.
	if (PRODUCTION_MODES.includes(mode)) return false;

	// No token means there is nothing to install; the old code assigned `undefined` to
	// window.FIREBASE_APPCHECK_DEBUG_TOKEN, which reads as "debug requested" to the SDK.
	if (!token) return false;

	return Boolean(dev || debugFlag);
}
