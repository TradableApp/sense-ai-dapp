/**
 * Whether Firebase App Check can be initialised at all.
 *
 * App Check attests that a request came from the real app. Its ReCaptchaEnterpriseProvider
 * needs a site key; with a blank one there is nothing to attest WITH, so initialising it does
 * not give weaker protection — it gives none, plus a guaranteed error.
 *
 * That error is easy to misread. reCAPTCHA reports it ASYNCHRONOUSLY, from inside the script it
 * injects, so it escapes the try/catch around Firebase initialisation and surfaces as a bare
 * console error:
 *
 *     Missing required parameters: sitekey
 *
 * The app keeps rendering, so nothing looks broken — but any check that asserts a clean console
 * fails, and it points at reCAPTCHA rather than at the unset variable that caused it. That is
 * what it cost to diagnose in CI, where VITE_RECAPTCHA_SITE_KEY is absent because the env file
 * carrying it is gitignored.
 *
 * Skipping is therefore the honest behaviour for an unconfigured environment, and it changes
 * nothing for a configured one: every deployed build sets the key, so App Check still
 * initialises everywhere it could have worked.
 */
export default function shouldInitialiseAppCheck(siteKey: string | undefined): boolean {
	// Trimmed, because a whitespace-only value is as unusable as an empty one and arrives the
	// same way — an env file with `VITE_RECAPTCHA_SITE_KEY= ` or a quoting mistake.
	return Boolean(siteKey && siteKey.trim());
}
