// @vitest-environment node
import { describe, expect, it } from 'vitest';

import isSessionOriginAllowed from '@/features/auth/sessionOrigin';

const LOOPBACK = [
	'http://localhost:3002',
	'http://localhost',
	'https://localhost:5173',
	'http://127.0.0.1:4173',
	'http://[::1]:3002',
];

const NEVER = [
	'null',
	'',
	'not a url',
	'https://localhost.example.com',
	'https://127.0.0.1.example.com',
	'file:///index.html',
];

describe('isSessionOriginAllowed', () => {
	it('allows a mainnet build only on the site its message names', () => {
		expect(isSessionOriginAllowed('mainnet', 'https://senseai.tradable.app')).toBe(true);

		[
			'https://sense-ai-app.web.app',
			'https://sense-ai-app.firebaseapp.com',
			'http://senseai.tradable.app',
			'https://senseai.tradable.app:8443',
			'https://www.senseai.tradable.app',
			...LOOPBACK,
			...NEVER,
		].forEach(origin => expect(isSessionOriginAllowed('mainnet', origin)).toBe(false));
	});

	it('allows a testnet build on its site and on this machine', () => {
		expect(isSessionOriginAllowed('testnet', 'https://sense-ai-app-garrick.web.app')).toBe(true);
		LOOPBACK.forEach(origin => expect(isSessionOriginAllowed('testnet', origin)).toBe(true));

		[
			'https://sense-ai-app-garrick.firebaseapp.com',
			'https://senseai.tradable.app',
			...NEVER,
		].forEach(origin => expect(isSessionOriginAllowed('testnet', origin)).toBe(false));
	});

	it('allows a localnet build or a unit-test run on this machine only', () => {
		['localnet', 'test'].forEach(mode => {
			LOOPBACK.forEach(origin => expect(isSessionOriginAllowed(mode, origin)).toBe(true));
			['https://senseai.tradable.app', 'https://sense-ai-app-garrick.web.app', ...NEVER].forEach(
				origin => expect(isSessionOriginAllowed(mode, origin)).toBe(false),
			);
		});
	});

	it('allows nothing for a mode with no site', () => {
		['production', 'toString', ''].forEach(mode => {
			expect(isSessionOriginAllowed(mode, 'http://localhost:3002')).toBe(false);
			expect(isSessionOriginAllowed(mode, 'https://senseai.tradable.app')).toBe(false);
		});
	});
});
