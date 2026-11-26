import { describe, expect, it } from 'vitest';

import withoutLaunchData from './launchData';

// What Telegram appends when it opens the dApp as a Mini App: the user and a signed hash.
const LAUNCH_DATA =
	'tgWebAppData=query_id%3DAAH%26user%3D%257B%2522id%2522%253A123456789%252C%2522first_name%2522%253A%2522Ann%2522%257D%26auth_date%3D1700000000%26hash%3Dabc123';
const LAUNCH_FRAGMENT = `${LAUNCH_DATA}&tgWebAppVersion=7.0&tgWebAppPlatform=ios&tgWebAppThemeParams=%7B%7D`;

describe('withoutLaunchData', () => {
	it('removes the launch parameters from the fragment', () => {
		expect(withoutLaunchData(`https://app.example/chat#${LAUNCH_FRAGMENT}`)).toBe(
			'https://app.example/chat',
		);
	});

	it('removes the launch parameters from the query', () => {
		expect(withoutLaunchData('https://app.example/chat?tgWebAppStartParam=ref42')).toBe(
			'https://app.example/chat',
		);
	});

	it('removes them from both, keeping every other parameter in its order', () => {
		expect(
			withoutLaunchData(
				`https://app.example/chat?a=1&tgWebAppStartParam=ref42&b=2#${LAUNCH_DATA}&section=3&tgWebAppVersion=7.0`,
			),
		).toBe('https://app.example/chat?a=1&b=2#section=3');
	});

	it('removes them from a relative URL', () => {
		expect(withoutLaunchData(`/chat?x=1#${LAUNCH_FRAGMENT}`)).toBe('/chat?x=1');
		expect(withoutLaunchData(`/#${LAUNCH_FRAGMENT}`)).toBe('/');
		expect(withoutLaunchData(`#${LAUNCH_FRAGMENT}`)).toBe('');
	});

	it('removes a parameter whose name is percent-encoded', () => {
		expect(withoutLaunchData('https://app.example/?tg%57ebAppData=x&keep=1')).toBe(
			'https://app.example/?keep=1',
		);
		expect(withoutLaunchData('https://app.example/#%74gWebAppVersion=7.0')).toBe(
			'https://app.example/',
		);
	});

	it('removes a launch parameter with no value', () => {
		expect(withoutLaunchData('https://app.example/#tgWebAppFullscreen&keep')).toBe(
			'https://app.example/#keep',
		);
	});

	it('returns a URL with no launch parameters unchanged', () => {
		[
			'https://app.example/chat',
			'https://app.example/chat?a=1&b=2#section',
			'https://app.example/?',
			'https://app.example/#',
			'/chat?tgwebappdata=lower-case-is-not-telegram',
			'/chat#notgWebAppData=1',
			'/chat?q=tgWebAppData',
		].forEach(url => expect(withoutLaunchData(url)).toBe(url));
	});

	it('returns a string that is not a URL unchanged', () => {
		[
			'',
			'$direct',
			'hello tgWebAppData=1',
			'tgWebAppData=1',
			'Clicked a&tgWebAppData=1',
			'https://app.example/chat#tgWebAppData=1 and more text',
		].forEach(text => expect(withoutLaunchData(text)).toBe(text));
	});

	it('leaves a part whose name cannot be decoded as it is', () => {
		expect(withoutLaunchData('https://app.example/?%E0%A4%A=1&tgWebAppData=x')).toBe(
			'https://app.example/?%E0%A4%A=1',
		);
	});
});
