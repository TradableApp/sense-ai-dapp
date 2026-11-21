import { describe, expect, it } from 'vitest';

import leaksPartOf from '@/test/leaksPartOf';

import {
	assertLocalStoreConfig,
	LocalStoreConfigError,
	localStoreName,
	resolveLocalStoreName,
} from './localStoreName';

const AGENT_A = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const AGENT_B = '0x1111111111111111111111111111111111111111';

describe('localStoreName', () => {
	it('names the store after the chain and the agent, with the address in lower case', () => {
		expect(localStoreName('84532', AGENT_A)).toBe(
			'SenseAI:84532:0xabcdef0123456789abcdef0123456789abcdef01',
		);
	});

	it('gives two agents on one chain two stores', () => {
		expect(localStoreName('84532', AGENT_A)).not.toBe(localStoreName('84532', AGENT_B));
	});

	it('gives one agent address on two chains two stores', () => {
		expect(localStoreName('84532', AGENT_A)).not.toBe(localStoreName('8453', AGENT_A));
	});

	it('gives the same agent one store however its address is written', () => {
		expect(localStoreName('84532', AGENT_A.toLowerCase())).toBe(localStoreName('84532', AGENT_A));
		expect(localStoreName(84532, AGENT_A)).toBe(localStoreName('84532', AGENT_A));
	});

	it.each([
		undefined,
		'',
		'undefined',
		'0x1234',
		'not-an-address',
		`0x${'a'.repeat(41)}`,
		`0x${'g'.repeat(40)}`,
	])('refuses the agent address %j rather than naming a store all agents would share', agent => {
		expect(() => localStoreName('84532', agent)).toThrow(LocalStoreConfigError);
	});

	it.each([undefined, '', 'abc', '0', '-1', '1.5'])('refuses the chain id %j', chainId => {
		expect(() => localStoreName(chainId, AGENT_A)).toThrow(LocalStoreConfigError);
	});
});

// A value in the wrong setting can be a secret: a private key pasted where the address goes
// is 64 hex digits, with or without 0x. The message goes to a terminal or a CI log, so it
// says what was expected and what was got by its shape only, never the value itself.
describe('localStoreName error messages', () => {
	const KEY = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
	const messageFor = (run: () => unknown): string => {
		try {
			run();
		} catch (error) {
			return (error as Error).message;
		}
		throw new Error('expected a throw');
	};
	// Any four characters in a row from the key, anywhere in the message, would be a leak.
	it('the leak check catches four characters of the key and no fewer are needed', () => {
		expect(leaksPartOf(`got ${KEY.slice(20, 24)} here`, KEY)).toBe(true);
		expect(leaksPartOf(`got ${KEY.slice(20, 23)} here`, KEY)).toBe(false);
	});

	it.each([KEY, `0x${KEY}`])('does not print an agent address that looks like a key', value => {
		const message = messageFor(() => localStoreName('84532', value));

		expect(leaksPartOf(message, KEY)).toBe(false);
	});

	it('does not print a chain id that looks like a key', () => {
		const message = messageFor(() => localStoreName(KEY, AGENT_A));

		expect(leaksPartOf(message, KEY)).toBe(false);
	});

	it('does not print the value when it stops a build', () => {
		const message = messageFor(() =>
			assertLocalStoreConfig('testnet', {
				VITE_CHAIN_ID: '84532',
				VITE_AGENT_CONTRACT_ADDRESS: KEY,
			}),
		);

		expect(leaksPartOf(message, KEY)).toBe(false);
	});

	it('says what an address should be and describes the value by its shape', () => {
		const message = messageFor(() => localStoreName('84532', KEY));

		expect(message).toMatch(/0x followed by 40 hex digits/);
		expect(message).toMatch(/64 characters/);
		expect(message).toMatch(/does not start with 0x/);
		expect(message).toMatch(/all hex/);
	});

	it('describes a prefixed value that is not all hex', () => {
		const message = messageFor(() => localStoreName('84532', `0x${'g'.repeat(40)}`));

		expect(message).toMatch(/42 characters/);
		expect(message).toMatch(/starts with 0x/);
		expect(message).toMatch(/not all hex/);
	});

	it.each([undefined, ''])('says an agent address of %j is empty', value => {
		expect(messageFor(() => localStoreName('84532', value))).toMatch(/got nothing/);
	});

	it('says what a chain id should be and describes the value by its shape', () => {
		const message = messageFor(() => localStoreName('abc', AGENT_A));

		expect(message).toMatch(/a whole number above 0/);
		expect(message).toMatch(/3 characters/);
		expect(message).not.toMatch(/abc/);
	});
});

describe('resolveLocalStoreName', () => {
	it.each(['localnet', 'testnet', 'mainnet'])(
		'names the store after the chain and agent in %s mode',
		mode => {
			expect(resolveLocalStoreName('84532', AGENT_A, mode)).toBe(localStoreName('84532', AGENT_A));
		},
	);

	it('gives a localnet build with no agent its own store, so a run with no contracts still loads', () => {
		const name = resolveLocalStoreName('31337', undefined, 'localnet');

		expect(name).toBe('SenseAI:localnet:unconfigured');
		expect(name).not.toBe(localStoreName('31337', AGENT_A));
	});

	it('gives a unit-test run with no agent that same store, so a test that loads the module unmocked is not failed by configuration', () => {
		expect(resolveLocalStoreName(undefined, undefined, 'test')).toBe(
			'SenseAI:localnet:unconfigured',
		);
	});

	it.each(['testnet', 'mainnet', 'production', 'development', undefined])(
		'refuses a missing agent in %s mode',
		mode => {
			expect(() => resolveLocalStoreName('84532', undefined, mode)).toThrow(LocalStoreConfigError);
		},
	);
});

describe('assertLocalStoreConfig', () => {
	const good = { VITE_CHAIN_ID: '84532', VITE_AGENT_CONTRACT_ADDRESS: AGENT_A };

	it.each(['testnet', 'mainnet'])('accepts a %s build that names its chain and agent', mode => {
		expect(() => assertLocalStoreConfig(mode, good)).not.toThrow();
	});

	it.each(['testnet', 'mainnet', 'production', 'development'])(
		'stops a %s build with no agent address',
		mode => {
			expect(() => assertLocalStoreConfig(mode, { VITE_CHAIN_ID: '84532' })).toThrow(
				LocalStoreConfigError,
			);
		},
	);

	it.each(['testnet', 'mainnet', 'production', 'development'])(
		'stops a %s build with no chain id',
		mode => {
			expect(() => assertLocalStoreConfig(mode, { VITE_AGENT_CONTRACT_ADDRESS: AGENT_A })).toThrow(
				LocalStoreConfigError,
			);
		},
	);

	it.each(['localnet', 'test'])('leaves a %s run with no agent alone', mode => {
		expect(() => assertLocalStoreConfig(mode, {})).not.toThrow();
		expect(() => assertLocalStoreConfig(mode, { VITE_CHAIN_ID: '31337' })).not.toThrow();
	});

	it.each(['localnet', 'test'])('accepts a %s run that names its chain and agent', mode => {
		expect(() => assertLocalStoreConfig(mode, good)).not.toThrow();
	});

	// The browser is strict as soon as an agent address is set, whatever the mode. A build
	// that let these through would load as a blank page.
	it.each(['localnet', 'test'])(
		'stops a %s run whose agent address is set but is not an address',
		mode => {
			expect(() =>
				assertLocalStoreConfig(mode, {
					VITE_CHAIN_ID: '31337',
					VITE_AGENT_CONTRACT_ADDRESS: '0x1234',
				}),
			).toThrow(LocalStoreConfigError);
		},
	);

	it.each(['localnet', 'test'])('stops a %s run with an agent address and no chain id', mode => {
		expect(() => assertLocalStoreConfig(mode, { VITE_AGENT_CONTRACT_ADDRESS: AGENT_A })).toThrow(
			LocalStoreConfigError,
		);
	});

	// One table for both sides: what the browser does with these settings, and what the build
	// check does with them, each against an outcome written here.
	it.each<[string, Record<string, string | undefined>, string | null]>([
		['localnet', {}, 'SenseAI:localnet:unconfigured'],
		['localnet', { VITE_CHAIN_ID: '31337' }, 'SenseAI:localnet:unconfigured'],
		['localnet', { VITE_AGENT_CONTRACT_ADDRESS: '' }, 'SenseAI:localnet:unconfigured'],
		['localnet', { VITE_CHAIN_ID: '31337', VITE_AGENT_CONTRACT_ADDRESS: '0x1234' }, null],
		['localnet', { VITE_AGENT_CONTRACT_ADDRESS: AGENT_A }, null],
		['localnet', good, `SenseAI:84532:${AGENT_A.toLowerCase()}`],
		['testnet', { VITE_CHAIN_ID: '84532' }, null],
		['testnet', { VITE_CHAIN_ID: '84532', VITE_AGENT_CONTRACT_ADDRESS: '' }, null],
		['testnet', good, `SenseAI:84532:${AGENT_A.toLowerCase()}`],
	])('gives a %s build with %o the outcome the browser gives it', (mode, env, storeName) => {
		const inBrowser = () =>
			resolveLocalStoreName(env.VITE_CHAIN_ID, env.VITE_AGENT_CONTRACT_ADDRESS, mode);
		const atBuild = () => assertLocalStoreConfig(mode, env);

		if (storeName === null) {
			expect(inBrowser).toThrow(LocalStoreConfigError);
			expect(atBuild).toThrow(LocalStoreConfigError);
		} else {
			expect(inBrowser()).toBe(storeName);
			expect(atBuild).not.toThrow();
		}
	});

	it('names the two settings and the mode when it stops a build', () => {
		expect(() => assertLocalStoreConfig('testnet', { VITE_CHAIN_ID: '84532' })).toThrow(
			/VITE_CHAIN_ID.*VITE_AGENT_CONTRACT_ADDRESS.*testnet/,
		);
	});
});
