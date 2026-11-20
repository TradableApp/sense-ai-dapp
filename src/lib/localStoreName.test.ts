import { describe, expect, it } from 'vitest';

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

	it.each([undefined, '', 'undefined', '0x1234', 'not-an-address'])(
		'refuses the agent address %j rather than naming a store all agents would share',
		agent => {
			expect(() => localStoreName('84532', agent)).toThrow(LocalStoreConfigError);
		},
	);

	it.each([undefined, '', 'abc', '0', '-1', '1.5'])('refuses the chain id %j', chainId => {
		expect(() => localStoreName(chainId, AGENT_A)).toThrow(LocalStoreConfigError);
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

	it.each([
		['localnet', {}],
		['localnet', { VITE_CHAIN_ID: '31337', VITE_AGENT_CONTRACT_ADDRESS: '0x1234' }],
		['localnet', { VITE_AGENT_CONTRACT_ADDRESS: AGENT_A }],
		['testnet', { VITE_CHAIN_ID: '84532' }],
		['testnet', good],
	] as const)('agrees with what the browser does for a %s build with %o', (mode, env) => {
		const browser = () =>
			resolveLocalStoreName(env.VITE_CHAIN_ID, env.VITE_AGENT_CONTRACT_ADDRESS, mode);
		let browserFails = false;
		try {
			browser();
		} catch {
			browserFails = true;
		}

		if (browserFails) expect(() => assertLocalStoreConfig(mode, env)).toThrow();
		else expect(() => assertLocalStoreConfig(mode, env)).not.toThrow();
	});
});
