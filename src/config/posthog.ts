import posthog from 'posthog-js';

import { loadState } from '@/lib/browserStorage';

export const INTERNAL_DOMAINS = ['tradable.app'];

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
			autocapture: true,
			capture_pageview: false,
			capture_pageleave: true,
			disable_session_recording: false,
			session_recording: { maskAllInputs: true },
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
		api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
		capture_pageview: false,
		autocapture: false,
		capture_pageleave: false,
		disable_session_recording: true,
		opt_out_capturing_by_default: true,
		opt_out_persistence_by_default: true,
		session_recording: { maskAllInputs: true },
		person_profiles: 'identified_only',
		debug: false, // !IS_PROD
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
