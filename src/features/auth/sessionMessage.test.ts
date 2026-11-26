// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	buildSessionMessage,
	SESSION_MESSAGE_VERSION,
	SessionMessageConfigError,
	sessionSiteFor,
} from '@/features/auth/sessionMessage';

const WALLET = '0xabc123def456abc123def456abc123def456abc1';
const OTHER_WALLET = '0x2222222222222222222222222222222222222222';

const MAINNET = {
	mode: 'mainnet',
	chainId: '8453',
	walletAddress: WALLET,
};

describe('buildSessionMessage', () => {
	it('is this exact text for a mainnet build', () => {
		expect(buildSessionMessage(MAINNET)).toBe(
			[
				'senseai.tradable.app asks you to sign this message with your account:',
				'0xAbc123def456aBc123def456aBc123DEf456ABc1',
				'',
				'Sign this only on https://senseai.tradable.app. Your signature creates the key that ' +
					'encrypts your SenseAI conversation history, and anyone who has the signature can ' +
					'read that history. Never sign this message on any other site, or for anyone who ' +
					'asks you to.',
				'',
				'Signing is free, sends no transaction and gives no permission to move your funds.',
				'',
				'Purpose: SenseAI conversation history encryption key',
				'Site: https://senseai.tradable.app',
				'Chain ID: 8453',
				'Message version: 2',
			].join('\n'),
		);
	});

	it('is the same text every time for one wallet, site and chain', () => {
		expect(buildSessionMessage(MAINNET)).toBe(buildSessionMessage({ ...MAINNET }));
	});

	// Replacing the contract pair on a network keeps every user's key, so history from an
	// earlier deployment can still be read.
	it('is the same text whatever agent contract the build names', () => {
		const withAgent = (agentAddress: string | undefined) =>
			({ ...MAINNET, agentAddress } as typeof MAINNET);

		const message = buildSessionMessage(MAINNET);
		expect(buildSessionMessage(withAgent('0x00000000000000000000000000000000000000a1'))).toBe(
			message,
		);
		expect(buildSessionMessage(withAgent(OTHER_WALLET))).toBe(message);
		expect(buildSessionMessage(withAgent(undefined))).toBe(message);
		expect(message).not.toMatch(/agent/i);
	});

	it('does not depend on how the addresses are written', () => {
		expect(
			buildSessionMessage({
				...MAINNET,
				walletAddress: WALLET.toUpperCase().replace('0X', '0x'),
			}),
		).toBe(buildSessionMessage(MAINNET));
	});

	it('takes the chain id as a number too', () => {
		expect(buildSessionMessage({ ...MAINNET, chainId: 8453 })).toBe(buildSessionMessage(MAINNET));
	});

	it('differs for another chain', () => {
		expect(buildSessionMessage({ ...MAINNET, chainId: '84532' })).not.toBe(
			buildSessionMessage(MAINNET),
		);
	});

	it('differs for another site', () => {
		const testnet = buildSessionMessage({ ...MAINNET, mode: 'testnet' });

		expect(testnet).not.toBe(buildSessionMessage(MAINNET));
		expect(testnet).toContain('Sign this only on https://sense-ai-app-garrick.web.app.');
		expect(testnet).not.toContain('senseai.tradable.app');
	});

	it('differs for another wallet', () => {
		expect(buildSessionMessage({ ...MAINNET, walletAddress: OTHER_WALLET })).not.toBe(
			buildSessionMessage(MAINNET),
		);
	});

	it('names the site on its first line and in the warning', () => {
		const lines = buildSessionMessage(MAINNET).split('\n');

		expect(lines[0].startsWith('senseai.tradable.app ')).toBe(true);
		expect(lines[3]).toContain('Never sign this message on any other site');
	});

	it('carries the version', () => {
		expect(SESSION_MESSAGE_VERSION).toBe(2);
		expect(buildSessionMessage(MAINNET)).toMatch(/\nMessage version: 2$/);
	});

	it('holds no time and nothing random', () => {
		const message = buildSessionMessage(MAINNET);

		expect(message).not.toMatch(/nonce|issued|expir|\d{4}-\d{2}-\d{2}/i);
	});

	it('stops when the mode has no site', () => {
		expect(() => buildSessionMessage({ ...MAINNET, mode: 'production' })).toThrow(
			SessionMessageConfigError,
		);
	});

	it('stops on a chain id that is not a whole number above 0, without printing it', () => {
		expect(() => buildSessionMessage({ ...MAINNET, chainId: '' })).toThrow(/chain id/);
		expect(() => buildSessionMessage({ ...MAINNET, chainId: undefined })).toThrow(/chain id/);
		expect(() => buildSessionMessage({ ...MAINNET, chainId: '0x2105' })).toThrow(
			SessionMessageConfigError,
		);
		expect(() => buildSessionMessage({ ...MAINNET, chainId: 'secret-value' })).not.toThrow(
			/secret-value/,
		);
	});

	it('stops on a wallet address that is not an address', () => {
		expect(() => buildSessionMessage({ ...MAINNET, walletAddress: '0x1234' })).toThrow(
			/wallet address/,
		);
	});

	it('names localhost:3002 for a localnet or unit-test run', () => {
		['localnet', 'test'].forEach(mode => {
			const message = buildSessionMessage({ ...MAINNET, mode, chainId: '31337' });

			expect(message).toContain('Sign this only on http://localhost:3002.');
			expect(message).toContain('\nChain ID: 31337\n');
		});
	});
});

describe('sessionSiteFor', () => {
	it('gives one site per network, never the page it is opened on', () => {
		expect(sessionSiteFor('mainnet')).toBe('https://senseai.tradable.app');
		expect(sessionSiteFor('testnet')).toBe('https://sense-ai-app-garrick.web.app');
		expect(sessionSiteFor('localnet')).toBe('http://localhost:3002');
		expect(sessionSiteFor('test')).toBe('http://localhost:3002');
	});

	it('gives nothing for a mode it does not know', () => {
		expect(sessionSiteFor('production')).toBeUndefined();
		expect(sessionSiteFor('toString')).toBeUndefined();
	});

	// Every mode a script builds or serves must be able to name its site, or signing in
	// would fail on that build.
	it('has a site for every mode a package script builds or serves', () => {
		const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
		const modes = new Set(
			Object.values(pkg.scripts as Record<string, string>).flatMap(script =>
				Array.from(script.matchAll(/--mode[= ](\S+)/g), match => match[1]),
			),
		);

		expect([...modes].sort()).toEqual(['localnet', 'mainnet', 'testnet']);
		modes.forEach(mode => expect(sessionSiteFor(mode)).toBeDefined());
	});
});
