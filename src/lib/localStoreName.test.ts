import { describe, expect, it } from 'vitest';

import { LocalStoreConfigError, localStoreName } from './localStoreName';

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
