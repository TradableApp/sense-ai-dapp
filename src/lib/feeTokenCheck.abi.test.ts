import type { AbiFunction } from 'viem';
import { describe, expect, it } from 'vitest';

import { FEE_TOKEN_PROFILES } from '@/config/feeToken';
import { ESCROW_FEE_TOKEN_GETTER } from '@/config/feeTokenConfig';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

// The check finds its reads by name in ABIs synced from other repositories. If a sync
// renamed one, every read would fail, the verdict would stay unknown and nothing would ever
// be blocked. These pin the names and shapes against the real files.
const fn = (abi: readonly unknown[], name: string) =>
	(abi as AbiFunction[]).find(item => item.type === 'function' && item.name === name);

const shape = (item: AbiFunction | undefined) => ({
	inputs: item?.inputs.map(input => input.type),
	outputs: item?.outputs.map(output => output.type),
	stateMutability: item?.stateMutability,
});

describe('the reads the fee token check depends on', () => {
	it.each([ESCROW_FEE_TOKEN_GETTER, 'treasury'])(
		'the escrow has %s() returning an address',
		name => {
			expect(shape(fn(EVMAIAgentEscrowABI.abi, name))).toEqual({
				inputs: [],
				outputs: ['address'],
				stateMutability: 'view',
			});
		},
	);

	it.each(Object.values(FEE_TOKEN_PROFILES))('$symbol has symbol() returning text', profile => {
		expect(shape(fn(profile.abi, 'symbol'))).toEqual({
			inputs: [],
			outputs: ['string'],
			stateMutability: 'view',
		});
	});

	it('every token that is not transferable can say whether an address is listed', () => {
		const restricted = Object.values(FEE_TOKEN_PROFILES).filter(profile => !profile.transferable);
		expect(restricted.length).toBeGreaterThan(0);
		restricted.forEach(profile => {
			expect(shape(fn(profile.abi, 'isTransferExempt'))).toEqual({
				inputs: ['address'],
				outputs: ['bool'],
				stateMutability: 'view',
			});
		});
	});
});
