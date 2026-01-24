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

	if (import.meta.env.VITE_POSTHOG_DEBUG_SECRET) {
		posthog.register({
			debug_secret: import.meta.env.VITE_POSTHOG_DEBUG_SECRET,
		});
	}

	// Auto-enable if user previously gave consent
	try {
		// Check if consent has been provided previously by the user
		const consentSettings = loadState('consentSettings') || {};

		const {
			// ad_storage: marketingStorage,
			analytics_storage: analyticsStorage,
			// personalization_storage: personalisationsStorage,
		} = consentSettings;

		if (analyticsStorage) {
			enablePosthogAfterConsent();
		}
	} catch {
		// ignore
	}
}
