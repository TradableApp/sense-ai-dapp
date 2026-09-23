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

/**
 * The ONLY build modes that may carry a debug token.
 *
 * An allowlist, not a list of production modes to refuse. A denylist fails OPEN: the next mode
 * anyone adds — `staging`, `prod`, a preview channel — is eligible by default, and the failure
 * is silent, surfacing whenever someone notices a debug token sitting in a deployed bundle.
 * Here a new mode has to be added deliberately, and the cost of forgetting is a developer
 * wondering why their debug token is ignored.
 */
const DEBUGGABLE_MODES = ['development', 'localnet', 'testnet'];

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
	// Checked FIRST and unconditionally: anything not on the allowlist is treated as production,
	// even if DEV is somehow true. This is the line the old gate did not have.
	if (!DEBUGGABLE_MODES.includes(mode)) return false;

	// No token means there is nothing to install; the old code assigned `undefined` to
	// window.FIREBASE_APPCHECK_DEBUG_TOKEN, which reads as "debug requested" to the SDK.
	if (!token) return false;

	return Boolean(dev || debugFlag);
}
