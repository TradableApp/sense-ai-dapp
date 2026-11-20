import { describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES } from '@/config/feeToken';

vi.mock('thirdweb/react', () => ({ useActiveWallet: () => undefined }));
vi.mock('@/config/contracts', () => ({
	CONTRACTS: {},
	LOCAL_CHAIN_ID: 31337,
	TESTNET_CHAIN_ID: 84532,
}));

import { shouldFetchMarketPrice } from './useTokenPrice';

const { SENSE, ABLE } = FEE_TOKEN_PROFILES;
const BASE = 8453;
const BASE_SEPOLIA = 84532;
const HARDHAT = 31337;
const TOKEN = '0x1111111111111111111111111111111111111111';

describe('shouldFetchMarketPrice', () => {
	it.each([BASE, BASE_SEPOLIA, HARDHAT])(
		'never asks for a price of a token that has none (chain %i)',
		chainId => {
			expect(shouldFetchMarketPrice(SENSE, chainId, TOKEN)).toBe(false);
		},
	);

	it('asks for the price of a priced token on mainnet', () => {
		expect(shouldFetchMarketPrice(ABLE, BASE, TOKEN)).toBe(true);
	});

	it.each([BASE_SEPOLIA, HARDHAT])('does not ask on a test chain (%i)', chainId => {
		expect(shouldFetchMarketPrice(ABLE, chainId, TOKEN)).toBe(false);
	});

	it('does not ask without a wallet chain or a token address', () => {
		expect(shouldFetchMarketPrice(ABLE, undefined, TOKEN)).toBe(false);
		expect(shouldFetchMarketPrice(ABLE, BASE, undefined)).toBe(false);
	});
});
