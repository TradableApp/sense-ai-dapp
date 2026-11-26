import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The installed analytics SDK, not a mock, with this app's options, opened the way Telegram
 * opens a Mini App: launch parameters in the page URL's query and fragment, the Telegram user
 * and a signed hash among them. Every request the SDK would send is read before it leaves (the
 * SDK's own request method is replaced, so nothing is sent), and none may carry them.
 */

const TELEGRAM_USER_ID = '123456789';
const LAUNCH_URL = `/chat?tgWebAppStartParam=ref42#tgWebAppData=query_id%3DAAH%26user%3D%257B%2522id%2522%253A${TELEGRAM_USER_ID}%257D%26auth_date%3D1700000000%26hash%3Dabc123&tgWebAppVersion=7.0&tgWebAppPlatform=ios`;

/** The SDK's own method that sends a request, by the name it keeps in the published bundle. */
const SEND_REQUEST = '_send_request';

type Request = { url: string; data?: unknown; callback?: (_response: unknown) => void };
const requests: Request[] = [];

beforeAll(async () => {
	window.history.replaceState(null, '', LAUNCH_URL);
	vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_test');
	const { default: posthog } = await import('posthog-js');
	const sdk = posthog as unknown as Record<string, unknown>;
	// Every request, an event's included, goes through this one; the test fails if it is gone.
	expect(typeof sdk[SEND_REQUEST]).toBe('function');
	const record = (request: Request) => {
		requests.push(JSON.parse(JSON.stringify(request)) as Request);
		// Answered, so that a request the SDK waits on does not hold back the next one.
		setTimeout(() => request.callback?.({ statusCode: 200, json: {} }), 0);
	};
	sdk[SEND_REQUEST] = record;

	const { initPosthog, enablePosthogAfterConsent } = await import('./posthog');
	initPosthog();
	// Each event on its own, and a test browser is not taken for a bot.
	posthog.set_config({ request_batching: false, opt_out_useragent_filter: true });
	enablePosthogAfterConsent();
	posthog.identify('0x70997970c51812dc3a010c7d01b50e0d17dc79c8', { plan: 'free' });
	posthog.capture('clicked');
	await new Promise<void>(resolve => {
		setTimeout(resolve, 200);
	});
});

afterAll(() => {
	vi.unstubAllEnvs();
});

describe('a Mini App launch, through the installed analytics SDK', () => {
	it('sends its events', () => {
		const events = requests.flatMap(request => {
			const { event } = (request.data ?? {}) as { event?: string };
			return event ? [event] : [];
		});
		expect(events).toEqual(expect.arrayContaining(['$pageview', '$identify', 'clicked']));
	});

	it('sends no request that carries the launch data', () => {
		const sent = JSON.stringify(requests);
		expect(sent).not.toContain('tgWebApp');
		expect(sent).not.toContain(TELEGRAM_USER_ID);
	});

	it('still names the page it was on, without the launch data', () => {
		const pageview = requests.find(
			request => (request.data as { event?: string } | undefined)?.event === '$pageview',
		);
		expect(
			(pageview?.data as { properties: Record<string, unknown> }).properties.$current_url,
		).toBe(`${window.location.origin}/chat`);
	});

	// Its person properties include the first page URL, and it is not an event.
	it('sends no feature flag request', () => {
		expect(requests.filter(request => request.url.includes('/flags'))).toEqual([]);
	});
});
