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

	it.each(['testnet', 'mainnet'])('stops a %s build with no agent address', mode => {
		expect(() => assertLocalStoreConfig(mode, { VITE_CHAIN_ID: '84532' })).toThrow(
			LocalStoreConfigError,
		);
	});

	it.each(['testnet', 'mainnet'])('stops a %s build with no chain id', mode => {
		expect(() => assertLocalStoreConfig(mode, { VITE_AGENT_CONTRACT_ADDRESS: AGENT_A })).toThrow(
			LocalStoreConfigError,
		);
	});

	it.each(['localnet', 'test', 'development'])('leaves a %s run alone', mode => {
		expect(() => assertLocalStoreConfig(mode, {})).not.toThrow();
	});
});
