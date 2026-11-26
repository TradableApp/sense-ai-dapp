import posthog, { type PostHogConfig } from 'posthog-js';

import { loadState } from '@/lib/browserStorage';

export const INTERNAL_DOMAINS = ['tradable.app'];

/**
 * Session replay, off. No replay purpose is set for this app, and conversation text is decrypted
 * on this device only. This one value is the switch: true turns replay on (and lets the SDK load
 * its recorder from the analytics host), with everything below still applied to it.
 */
export const RECORD_SESSIONS = false;

const API_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

/** The replay recorder's path on the analytics host. */
const RECORDER_PATH = /^\/static\/(?:lazy-recorder|posthog-recorder)\.js$/;

/**
 * Whether a script is the replay recorder: the one script the SDK may load, with replay on. It
 * is known by its host as well as its path: over https, from the analytics vendor's own hosts or
 * the host this build sends analytics to.
 */
function isRecorderScript(src: string): boolean {
	try {
		const { protocol, hostname, pathname } = new URL(src);
		const isAnalyticsHost =
			hostname.endsWith('.posthog.com') || hostname === new URL(API_HOST).hostname;
		return protocol === 'https:' && isAnalyticsHost && RECORDER_PATH.test(pathname);
	} catch {
		return false;
	}
}

/**
 * What analytics may capture, the same before and after consent, set in code so a project
 * setting cannot turn a channel on: no element text or attribute values in autocapture (and
 * nothing at all inside `ph-no-capture`, which every container of conversation text carries);
 * no heatmaps, dead clicks, exceptions, console logs, performance or network timing; no
 * surveys, conversations, product tours or web experiments; and no script loaded from the
 * analytics host, which is how the SDK would start a channel the project turned on (with replay
 * on, the recorder alone, `isRecorderScript`). Replay, if switched on, blocks every
 * `ph-no-capture` element, masks all text and all inputs, and records no canvas, header, body or
 * network request.
 */
const PRIVACY_OPTIONS = {
	mask_all_text: true,
	mask_all_element_attributes: true,
	capture_heatmaps: false,
	capture_dead_clicks: false,
	capture_exceptions: false,
	capture_performance: false,
	enable_recording_console_log: false,
	// Asked for, but the project's settings can turn console capture on over this: what stops it
	// is that its script is never loaded (`disable_external_dependency_loading`, or the recorder
	// alone with replay on).
	logs: { captureConsoleLogs: false },
	disable_surveys: true,
	disable_conversations: true,
	disable_product_tours: true,
	disable_web_experiments: true,
	disable_session_recording: !RECORD_SESSIONS,
	disable_external_dependency_loading: !RECORD_SESSIONS,
	prepare_external_dependency_script: (script: HTMLScriptElement) =>
		isRecorderScript(script.src) ? script : null,
	session_recording: {
		maskAllInputs: true,
		maskTextSelector: '*',
		blockClass: 'ph-no-capture',
		recordHeaders: false,
		recordBody: false,
		captureCanvas: { recordCanvas: false },
		maskCapturedNetworkRequestFn: () => null,
	},
} satisfies Partial<PostHogConfig>;

let isEnabled = false;

/**
 * Opt in and start PostHog tracking once user consents.
 */
export function enablePosthogAfterConsent() {
	if (isEnabled) return;
	isEnabled = true;

	try {
		posthog.opt_in_capturing();
		posthog.set_config({
			// Clicks only: copied or cut text is never captured.
			autocapture: { capture_copied_text: false },
			capture_pageview: false,
			capture_pageleave: true,
			...PRIVACY_OPTIONS,
		});

		posthog.capture('$pageview', { $current_url: window.location.href });
	} catch (error) {
		console.warn('[PostHog] enable error:', error);
	}
}

/**
 * Opt out and stop PostHog tracking when user revokes consent.
 */
export function disablePosthogAfterOptOut() {
	try {
		if (posthog.isFeatureEnabled('session_recording')) {
			posthog.stopSessionRecording();
		}
		posthog.opt_out_capturing();
		// You might not need to call posthog.reset() here, as opt_out_capturing should be sufficient
		// and reset() can clear things you might want to keep (like device ID).
		// Test this, but opt_out_capturing() is the primary function.
		isEnabled = false;
	} catch (error) {
		console.warn('[PostHog] disable error:', error);
	}
}

export function initPosthog() {
	const ENV = import.meta.env.MODE; // 'development', 'production', 'testnet', etc.
	// const IS_PROD = ENV === 'production' || ENV === 'mainnet';

	posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
		api_host: API_HOST,
		capture_pageview: false,
		autocapture: false,
		capture_pageleave: false,
		opt_out_capturing_by_default: true,
		opt_out_persistence_by_default: true,
		person_profiles: 'identified_only',
		debug: false, // !IS_PROD
		...PRIVACY_OPTIONS,
	});

	// Segment this data from the main app
	posthog.register({
		app_name: 'SenseAI',
		env: ENV,
		buildVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
	});
	posthog.register_once({ host: window.location.host });

	// NOT a secret, and no longer named like one. Every VITE_* value is INLINED into the client
	// bundle at build time, so this string ships to every visitor in plain text and is readable
	// with view-source. It was registered as a super property called `debug_secret`, which meant
	// it was also attached to every event PostHog received.
	//
	// PostHog's own position is that there is nothing private on the client: the project API key
	// is public by design, and its write-only ingestion endpoint is what makes that safe. The
	// legitimate use of a value like this is LABELLING internal traffic so it can be filtered out
	// of product analytics, which needs no confidentiality at all.
	//
	// So it is renamed to say what it is. If anything here ever needs to be genuinely secret, it
	// cannot live in the frontend bundle under any name.
	if (import.meta.env.VITE_POSTHOG_DEBUG_LABEL) {
		posthog.register({
			debug_label: import.meta.env.VITE_POSTHOG_DEBUG_LABEL,
		});
	}

	// Auto-enable if user previously gave consent
	try {
		// Check if consent has been provided previously by the user
		const consentSettings = (loadState('consentSettings') || {}) as Record<string, unknown>;

		const analyticsStorage = consentSettings.analytics_storage;

		if (analyticsStorage) {
			enablePosthogAfterConsent();
		}
	} catch {
		// ignore
	}
}
