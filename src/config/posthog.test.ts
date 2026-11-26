import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the analytics SDK is told it may capture, before and after consent. Conversation text is
 * decrypted on this device only, so no channel the SDK has may carry it: session replay is off,
 * and would block and mask everything if turned back on; autocapture keeps no element text or
 * attributes; heatmaps, dead clicks, exceptions, console logs, performance and network capture
 * are off; and no script is loaded from the analytics host, which a project setting could
 * otherwise use to start any of them.
 */

const posthog = vi.hoisted(() => ({
	init: vi.fn(),
	register: vi.fn(),
	register_once: vi.fn(),
	opt_in_capturing: vi.fn(),
	set_config: vi.fn(),
	capture: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));
const consent = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/lib/browserStorage', () => ({ loadState: () => consent.value }));

const PRIVACY = {
	mask_all_text: true,
	mask_all_element_attributes: true,
	capture_heatmaps: false,
	capture_dead_clicks: false,
	capture_exceptions: false,
	capture_performance: false,
	enable_recording_console_log: false,
	logs: { captureConsoleLogs: false },
	disable_surveys: true,
	disable_conversations: true,
	disable_product_tours: true,
	disable_web_experiments: true,
	disable_session_recording: true,
	disable_external_dependency_loading: true,
	prepare_external_dependency_script: expect.any(Function),
	session_recording: {
		maskAllInputs: true,
		maskTextSelector: '*',
		blockClass: 'ph-no-capture',
		recordHeaders: false,
		recordBody: false,
		captureCanvas: { recordCanvas: false },
		maskCapturedNetworkRequestFn: expect.any(Function),
	},
};

async function load() {
	vi.resetModules();
	return import('./posthog');
}

beforeEach(() => {
	vi.clearAllMocks();
	consent.value = {};
});

describe('PostHog options', () => {
	it('starts opted out, capturing nothing, with the privacy options', async () => {
		const { initPosthog } = await load();

		initPosthog();

		expect(posthog.init).toHaveBeenCalledTimes(1);
		expect(posthog.init.mock.calls[0][1]).toEqual({
			api_host: expect.any(String),
			capture_pageview: false,
			autocapture: false,
			capture_pageleave: false,
			opt_out_capturing_by_default: true,
			opt_out_persistence_by_default: true,
			person_profiles: 'identified_only',
			debug: false,
			...PRIVACY,
		});
		expect(posthog.set_config).not.toHaveBeenCalled();
	});

	it('after consent turns on autocapture and page leave only, keeping the privacy options', async () => {
		const { enablePosthogAfterConsent } = await load();

		enablePosthogAfterConsent();

		expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
		expect(posthog.set_config).toHaveBeenCalledTimes(1);
		expect(posthog.set_config.mock.calls[0][0]).toEqual({
			autocapture: { capture_copied_text: false },
			capture_pageview: false,
			capture_pageleave: true,
			...PRIVACY,
		});
	});

	it('records no network request even if replay is turned on', async () => {
		const { enablePosthogAfterConsent } = await load();

		enablePosthogAfterConsent();

		const { maskCapturedNetworkRequestFn } = posthog.set_config.mock.calls[0][0].session_recording;
		expect(maskCapturedNetworkRequestFn({ name: 'https://graph.example/q' })).toBeNull();
	});

	it('would load the replay recorder alone from the analytics host', async () => {
		const { enablePosthogAfterConsent } = await load();

		enablePosthogAfterConsent();

		const prepare = posthog.set_config.mock.calls[0][0].prepare_external_dependency_script;
		const script = (src: string) => Object.assign(document.createElement('script'), { src });
		const recorder = script('https://eu-assets.i.posthog.com/static/lazy-recorder.js?v=1');
		expect(prepare(recorder)).toBe(recorder);
		['logs', 'surveys', 'toolbar', 'exception-autocapture', 'dead-clicks-autocapture'].forEach(
			kind =>
				expect(prepare(script(`https://eu-assets.i.posthog.com/static/${kind}.js?v=1`))).toBeNull(),
		);
	});

	it('keeps replay off unless the one switch is changed', async () => {
		const { RECORD_SESSIONS } = await load();

		expect(RECORD_SESSIONS).toBe(false);
	});

	it('applies consent given earlier with the same options', async () => {
		consent.value = { analytics_storage: true };
		const { initPosthog } = await load();

		initPosthog();

		expect(posthog.set_config.mock.calls[0][0]).toMatchObject(PRIVACY);
	});
});
