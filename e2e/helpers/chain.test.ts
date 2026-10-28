// @vitest-environment node
//
// Contract tests for the chain adapter's PURE surface: how the suite decides which chain it is
// on, which RPC methods that chain may be asked for, and what configuration the testnet mode
// needs before a single request is made. Nothing here touches a network; the network-facing
// functions are exercised against Hardhat (localnet suite) and Base Sepolia (run day).
import { describe, expect, it } from 'vitest';

import {
	assertRpcMethodAllowed,
	chainIdHex,
	isLiveStack,
	readChainConfig,
	redactUrl,
	resolveChain,
} from './chain';

const TESTNET_ENV = {
	E2E_TESTNET: '1',
	E2E_TESTNET_CHAIN_ID: '84532',
	E2E_TESTNET_RPC_URL: 'https://base-sepolia.g.alchemy.com/v2/not-a-real-key',
	E2E_TESTNET_TOKEN_ADDRESS: '0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80',
	E2E_TESTNET_TREASURY_ADDRESS: '0xA0AbBe63967f1EDF753Ad7557904Ef1410179c6B',
	E2E_TESTNET_TREASURY_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
	E2E_TESTNET_SEED: 'ab'.repeat(32),
	E2E_TESTNET_ACCOUNTS_FILE: '/tmp/accounts.json',
	E2E_BASE_URL: 'https://sense-ai-app-garrick.web.app',
	VITE_ESCROW_CONTRACT_ADDRESS: '0x36ec08471F2b995024967204D7542713cFaf5Fa4',
	VITE_AGENT_CONTRACT_ADDRESS: '0x4a0C7e5807f9174499a8F56F2C69c61b39a4c64D',
};

describe('resolveChain', () => {
	it('defaults to localnet when nothing selects a chain', () => {
		expect(resolveChain({})).toBe('localnet');
		expect(resolveChain({ E2E_LOCAL_SERVICES: '1' })).toBe('localnet');
	});

	it('selects testnet from the runner flag or an explicit chain name', () => {
		expect(resolveChain({ E2E_TESTNET: '1' })).toBe('testnet');
		expect(resolveChain({ E2E_CHAIN: 'testnet' })).toBe('testnet');
	});

	it('lets an explicit chain name win over the runner flag', () => {
		expect(resolveChain({ E2E_CHAIN: 'localnet', E2E_TESTNET: '1' })).toBe('localnet');
	});

	it('refuses an unknown chain name, naming the variable', () => {
		expect(() => resolveChain({ E2E_CHAIN: 'mainnet' })).toThrow(/E2E_CHAIN.*mainnet/);
	});
});

describe('isLiveStack', () => {
	it('is false for a mocked run with no stack', () => {
		expect(isLiveStack({})).toBe(false);
	});

	it('is true on localnet only when the local services flag is set', () => {
		expect(isLiveStack({ E2E_LOCAL_SERVICES: '1' })).toBe(true);
		expect(isLiveStack({ E2E_LOCAL_SERVICES: '0' })).toBe(false);
	});

	it('is always true on testnet — the stack is real infrastructure', () => {
		expect(isLiveStack({ E2E_TESTNET: '1' })).toBe(true);
		expect(isLiveStack({ E2E_CHAIN: 'testnet', E2E_LOCAL_SERVICES: '0' })).toBe(true);
	});
});

describe('assertRpcMethodAllowed', () => {
	it('allows every method on localnet, including the dev-node built-ins', () => {
		for (const method of ['eth_call', 'hardhat_setBalance', 'evm_snapshot', 'anvil_mine']) {
			expect(() => assertRpcMethodAllowed('localnet', method)).not.toThrow();
		}
	});

	it('allows standard JSON-RPC on testnet', () => {
		for (const method of [
			'eth_call',
			'eth_getBalance',
			'eth_sendRawTransaction',
			'eth_getTransactionReceipt',
			'eth_chainId',
			'net_version',
			'eth_estimateGas',
		]) {
			expect(() => assertRpcMethodAllowed('testnet', method)).not.toThrow();
		}
	});

	it('refuses every dev-node namespace on testnet, naming the method', () => {
		for (const method of [
			'hardhat_setBalance',
			'hardhat_impersonateAccount',
			'hardhat_mine',
			'evm_snapshot',
			'evm_revert',
			'evm_increaseTime',
			'evm_mine',
			'anvil_setBalance',
			'debug_traceTransaction',
			'miner_start',
		]) {
			expect(() => assertRpcMethodAllowed('testnet', method)).toThrow(
				new RegExp(`${method}.*testnet|testnet.*${method}`),
			);
		}
	});

	it('refuses eth_sendTransaction on testnet — nothing is unlocked on a public node', () => {
		expect(() => assertRpcMethodAllowed('testnet', 'eth_sendTransaction')).toThrow(
			/eth_sendTransaction/,
		);
	});
});

describe('readChainConfig', () => {
	it('builds the localnet config from the synced VITE_* env with the Hardhat defaults', () => {
		const cfg = readChainConfig({
			VITE_TOKEN_CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
			VITE_ESCROW_CONTRACT_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
		});
		expect(cfg.chain).toBe('localnet');
		expect(cfg.chainId).toBe(31337);
		expect(cfg.rpcUrl).toBe('http://127.0.0.1:8545');
		expect(cfg.tokenAddress).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3');
		expect(cfg.escrowAddress).toBe('0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');
	});

	it('honours the synced localnet RPC URL', () => {
		expect(readChainConfig({ VITE_CHAIN_RPC_URL: 'http://127.0.0.1:9545' }).rpcUrl).toBe(
			'http://127.0.0.1:9545',
		);
	});

	it('builds the testnet config from the runner contract', () => {
		const cfg = readChainConfig(TESTNET_ENV);
		expect(cfg.chain).toBe('testnet');
		expect(cfg.chainId).toBe(84532);
		expect(cfg.rpcUrl).toBe(TESTNET_ENV.E2E_TESTNET_RPC_URL);
		expect(cfg.tokenAddress).toBe(TESTNET_ENV.E2E_TESTNET_TOKEN_ADDRESS);
		expect(cfg.escrowAddress).toBe(TESTNET_ENV.VITE_ESCROW_CONTRACT_ADDRESS);
		expect(cfg.baseUrl).toBe(TESTNET_ENV.E2E_BASE_URL);
		if (cfg.chain !== 'testnet') throw new Error('unreachable');
		expect(cfg.treasuryAddress).toBe(TESTNET_ENV.E2E_TESTNET_TREASURY_ADDRESS);
		expect(cfg.treasuryPrivateKey).toBe(TESTNET_ENV.E2E_TESTNET_TREASURY_PRIVATE_KEY);
		expect(cfg.seed).toBe(TESTNET_ENV.E2E_TESTNET_SEED);
		expect(cfg.accountsFile).toBe(TESTNET_ENV.E2E_TESTNET_ACCOUNTS_FILE);
		expect(cfg.prefundedCount).toBe(4);
	});

	it('reads the pre-funded account count from the runner when given', () => {
		const cfg = readChainConfig({ ...TESTNET_ENV, E2E_TESTNET_ACCOUNT_COUNT: '6' });
		if (cfg.chain !== 'testnet') throw new Error('unreachable');
		expect(cfg.prefundedCount).toBe(6);
	});

	it('names EVERY missing testnet variable in one error, so a run fails once, not per variable', () => {
		const { E2E_TESTNET_SEED: _seed, E2E_TESTNET_RPC_URL: _rpc, ...partial } = TESTNET_ENV;
		expect(() => readChainConfig(partial)).toThrow(
			/E2E_TESTNET_SEED[\s\S]*E2E_TESTNET_RPC_URL|E2E_TESTNET_RPC_URL[\s\S]*E2E_TESTNET_SEED/,
		);
	});

	it('refuses a malformed treasury key, seed or chain id before any request is made', () => {
		expect(() =>
			readChainConfig({ ...TESTNET_ENV, E2E_TESTNET_TREASURY_PRIVATE_KEY: '0xabc' }),
		).toThrow(/E2E_TESTNET_TREASURY_PRIVATE_KEY/);
		expect(() => readChainConfig({ ...TESTNET_ENV, E2E_TESTNET_SEED: 'zz'.repeat(32) })).toThrow(
			/E2E_TESTNET_SEED/,
		);
		expect(() => readChainConfig({ ...TESTNET_ENV, E2E_TESTNET_CHAIN_ID: 'base' })).toThrow(
			/E2E_TESTNET_CHAIN_ID/,
		);
	});

	it('never echoes the key, the seed or the RPC URL in a validation error', () => {
		let message = '';
		try {
			readChainConfig({ ...TESTNET_ENV, E2E_TESTNET_CHAIN_ID: 'base' });
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).not.toContain(TESTNET_ENV.E2E_TESTNET_TREASURY_PRIVATE_KEY);
		expect(message).not.toContain(TESTNET_ENV.E2E_TESTNET_SEED);
		expect(message).not.toContain('not-a-real-key');
	});
});

describe('chainIdHex', () => {
	it('formats the EIP-155 id the way an injected wallet reports it', () => {
		expect(chainIdHex(31337)).toBe('0x7a69');
		expect(chainIdHex(84532)).toBe('0x14a34');
	});
});

describe('redactUrl', () => {
	it('keeps the host and drops the path that carries a provider key', () => {
		expect(redactUrl('https://base-sepolia.g.alchemy.com/v2/not-a-real-key')).toBe(
			'https://base-sepolia.g.alchemy.com/…',
		);
	});

	it('leaves a keyless public endpoint readable', () => {
		expect(redactUrl('https://sepolia.base.org')).toBe('https://sepolia.base.org/…');
		expect(redactUrl('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545/…');
	});

	it('does not throw on garbage — a redaction helper must never be the thing that crashes', () => {
		expect(redactUrl('not a url')).toBe('<unparseable url>');
	});
});
