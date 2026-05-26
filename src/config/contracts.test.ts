import { describe, expect, it } from 'vitest';

import { CONTRACTS, LOCAL_CHAIN_ID, SUPPORTED_TOKENS, TESTNET_CHAIN_ID } from './contracts';

describe('contracts config', () => {
	describe('chain ID constants', () => {
		it('LOCAL_CHAIN_ID is Hardhat (31337)', () => {
			expect(LOCAL_CHAIN_ID).toBe(31337);
		});

		it('TESTNET_CHAIN_ID is Base Sepolia (84532)', () => {
			expect(TESTNET_CHAIN_ID).toBe(84532);
		});
	});

	describe('CONTRACTS', () => {
		it('has at least one chain entry', () => {
			const chainIds = Object.keys(CONTRACTS);
			expect(chainIds.length).toBeGreaterThanOrEqual(1);
		});

		it('each chain entry has token, agent, and escrow configs', () => {
			Object.values(CONTRACTS).forEach(config => {
				expect(config).toHaveProperty('token');
				expect(config).toHaveProperty('agent');
				expect(config).toHaveProperty('escrow');

				expect(config.token).toHaveProperty('address');
				expect(config.token).toHaveProperty('abi');
				expect(config.agent).toHaveProperty('address');
				expect(config.agent).toHaveProperty('abi');
				expect(config.escrow).toHaveProperty('address');
				expect(config.escrow).toHaveProperty('abi');
			});
		});

		it('ABIs are arrays with at least one entry', () => {
			Object.values(CONTRACTS).forEach(config => {
				expect(Array.isArray(config.token.abi)).toBe(true);
				expect(config.token.abi.length).toBeGreaterThan(0);
				expect(Array.isArray(config.agent.abi)).toBe(true);
				expect(config.agent.abi.length).toBeGreaterThan(0);
				expect(Array.isArray(config.escrow.abi)).toBe(true);
				expect(config.escrow.abi.length).toBeGreaterThan(0);
			});
		});

		it('ABIs contain standard function/event entries', () => {
			Object.values(CONTRACTS).forEach(config => {
				const tokenTypes = config.token.abi.map((e: { type: string }) => e.type);
				expect(tokenTypes).toContain('function');
			});
		});
	});

	describe('SUPPORTED_TOKENS', () => {
		it('has at least one chain entry', () => {
			const chainIds = Object.keys(SUPPORTED_TOKENS);
			expect(chainIds.length).toBeGreaterThanOrEqual(1);
		});

		it('each entry has required token metadata', () => {
			Object.values(SUPPORTED_TOKENS).forEach(tokens => {
				expect(Array.isArray(tokens)).toBe(true);
				tokens.forEach(token => {
					expect(token).toHaveProperty('address');
					expect(token).toHaveProperty('name');
					expect(token).toHaveProperty('symbol');
					expect(token.symbol).toBe('ABLE');
					expect(token.name).toBe('ABLE Token');
				});
			});
		});
	});
});
