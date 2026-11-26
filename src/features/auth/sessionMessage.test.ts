// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';

import {
	buildSessionMessage,
	SESSION_ISSUED_AT,
	SESSION_MESSAGE_VERSION,
	SESSION_NONCE,
	SessionMessageConfigError,
	sessionSiteFor,
} from '@/features/auth/sessionMessage';

// Hardhat's well-known account 0, in lower case and checksummed.
const WALLET = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const WALLET_CHECKSUMMED = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER_WALLET = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

const MAINNET = {
	mode: 'mainnet',
	chainId: '8453',
	walletAddress: WALLET,
};

const MAINNET_STATEMENT =
	'Sign this only on https://senseai.tradable.app. Your signature creates the key that ' +
	'encrypts your SenseAI conversation history, and anyone who has the signature can read ' +
	'that history. Never sign this message on any other site. Signing is free and sends no ' +
	'transaction.';

// EIP-4361's statement: reserved and unreserved URI characters and spaces, on one line.
const STATEMENT_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;= ]+$/;

describe('buildSessionMessage', () => {
	it('is this exact text for a mainnet build', () => {
		expect(buildSessionMessage(MAINNET)).toBe(
			[
				'senseai.tradable.app wants you to sign in with your Ethereum account:',
				WALLET_CHECKSUMMED,
				'',
				MAINNET_STATEMENT,
				'',
				'URI: https://senseai.tradable.app',
				'Version: 1',
				'Chain ID: 8453',
				'Nonce: SenseAIHistoryKeyV3',
				'Issued At: 2026-11-25T00:00:00.000Z',
			].join('\n'),
		);
	});

	it('parses as EIP-4361 to exactly the fields it was built from', () => {
		expect(parseSiweMessage(buildSessionMessage(MAINNET))).toEqual({
			domain: 'senseai.tradable.app',
			address: WALLET_CHECKSUMMED,
			statement: MAINNET_STATEMENT,
			uri: 'https://senseai.tradable.app',
			version: '1',
			chainId: 8453,
			nonce: 'SenseAIHistoryKeyV3',
			issuedAt: new Date('2026-11-25T00:00:00.000Z'),
		});
	});

	it('names the http scheme for a local site, and parses to it', () => {
		const parsed = parseSiweMessage(
			buildSessionMessage({ ...MAINNET, mode: 'localnet', chainId: '31337' }),
		);

		expect(parsed).toMatchObject({
			scheme: 'http',
			domain: 'localhost:3002',
			uri: 'http://localhost:3002',
			chainId: 31337,
		});
	});

	it('is valid for the site it names and for no other', () => {
		const parsed = parseSiweMessage(buildSessionMessage(MAINNET));

		expect(
			validateSiweMessage({ message: parsed, domain: 'senseai.tradable.app', address: WALLET }),
		).toBe(true);
		expect(validateSiweMessage({ message: parsed, domain: 'sense-ai-app.web.app' })).toBe(false);
		expect(validateSiweMessage({ message: parsed, address: OTHER_WALLET })).toBe(false);
	});

	it('has a one-line statement in the characters EIP-4361 allows', () => {
		['mainnet', 'testnet', 'localnet', 'test'].forEach(mode => {
			const { statement } = parseSiweMessage(buildSessionMessage({ ...MAINNET, mode }));

			expect(statement).toMatch(STATEMENT_CHARACTERS);
			expect(statement).toContain('creates the key that encrypts');
			expect(statement).toContain('Never sign this message on any other site');
		});
	});

	it('carries the message version in a fixed nonce', () => {
		expect(SESSION_MESSAGE_VERSION).toBe(3);
		expect(SESSION_NONCE).toBe(`SenseAIHistoryKeyV${SESSION_MESSAGE_VERSION}`);
		expect(SESSION_NONCE).toMatch(/^[A-Za-z0-9]{8,}$/);
		expect(buildSessionMessage(MAINNET)).toContain(`\nNonce: ${SESSION_NONCE}\n`);
	});

	it('has a fixed issue time and no field that limits or names one request', () => {
		const message = buildSessionMessage(MAINNET);

		expect(SESSION_ISSUED_AT.toISOString()).toBe('2026-11-25T00:00:00.000Z');
		expect(message).not.toMatch(/Expiration Time:|Not Before:|Request ID:|Resources:/);
	});

	it('is the same text every time for one wallet, site and chain', () => {
		expect(buildSessionMessage(MAINNET)).toBe(buildSessionMessage({ ...MAINNET }));
	});

	// Replacing the contract pair on a network keeps every user's key, so history from an
	// earlier deployment can still be read.
	it('names no agent contract', () => {
		expect(buildSessionMessage(MAINNET)).not.toMatch(/agent/i);
	});

	it('does not depend on how the address is written', () => {
		expect(buildSessionMessage({ ...MAINNET, walletAddress: WALLET_CHECKSUMMED })).toBe(
			buildSessionMessage(MAINNET),
		);
		expect(
			buildSessionMessage({ ...MAINNET, walletAddress: `0x${WALLET.slice(2).toUpperCase()}` }),
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
		expect(parseSiweMessage(testnet)).toMatchObject({
			domain: 'sense-ai-app-garrick.web.app',
			uri: 'https://sense-ai-app-garrick.web.app',
		});
		expect(testnet).not.toContain('senseai.tradable.app');
	});

	it('differs for another wallet', () => {
		expect(buildSessionMessage({ ...MAINNET, walletAddress: OTHER_WALLET })).not.toBe(
			buildSessionMessage(MAINNET),
		);
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

		const refuse = () => buildSessionMessage({ ...MAINNET, chainId: 'secret-value' });
		expect(refuse).toThrow(SessionMessageConfigError);
		expect(refuse).not.toThrow(/secret-value/);
	});

	it('stops on a wallet address that is not an address', () => {
		expect(() => buildSessionMessage({ ...MAINNET, walletAddress: '0x1234' })).toThrow(
			/wallet address/,
		);
	});

	it('names localhost:3002 for a localnet or unit-test run', () => {
		['localnet', 'test'].forEach(mode => {
			const message = buildSessionMessage({ ...MAINNET, mode, chainId: '31337' });

			expect(message.startsWith('http://localhost:3002 wants you to sign in')).toBe(true);
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
