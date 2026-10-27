// @vitest-environment node
//
// The mock wallet is a string that becomes `window.ethereum` in the page. On localnet it talks
// to Hardhat directly; on testnet it must not — every call crosses a Node-side binding so the
// private RPC URL never enters the browser and no dev-node method can be issued. These tests
// pin that split at the string level, which is the level the init script is injected at.
import { describe, expect, it } from 'vitest';

import { buildMockWalletScript, TEST_ACCOUNT } from './mock-wallet';

const RPC_URL = process.env.VITE_CHAIN_RPC_URL || 'http://127.0.0.1:8545';
const EPHEMERAL = { address: '0xaaaa000000000000000000000000000000000007' };

describe('buildMockWalletScript — localnet (unchanged behaviour)', () => {
	it('defaults to the localnet script for Hardhat account #1', () => {
		const script = buildMockWalletScript();
		expect(script).toContain(`'${TEST_ACCOUNT.address}'`);
		expect(script).toContain("'0x7a69'");
		expect(script).toContain(`'${RPC_URL}'`);
	});

	it('is byte-identical whether the chain is implied or named — nothing changes for the localnet suite', () => {
		expect(buildMockWalletScript(TEST_ACCOUNT, { chain: 'localnet', chainId: 31337 })).toBe(
			buildMockWalletScript(),
		);
	});

	it('still signs and sends through the node on localnet', () => {
		const script = buildMockWalletScript(EPHEMERAL, { chain: 'localnet', chainId: 31337 });
		expect(script).toContain("rpc('eth_sendTransaction'");
		expect(script).toContain("rpc('personal_sign'");
	});
});

describe('buildMockWalletScript — testnet signing mode', () => {
	const script = buildMockWalletScript(EPHEMERAL, { chain: 'testnet', chainId: 84532 });

	it('reports the configured chain to the dApp', () => {
		expect(script).toContain("'0x14a34'");
		expect(script).toContain("'84532'");
		expect(script).not.toContain("'0x7a69'");
	});

	it('carries no RPC URL — the browser never learns where the chain is', () => {
		expect(script).not.toMatch(/https?:\/\//);
		expect(script).not.toContain('127.0.0.1');
		expect(script).not.toContain('fetch(');
	});

	it('routes every JSON-RPC call through the Node binding', () => {
		expect(script).toContain('window.__mockRpc(');
	});

	it('signs messages and typed data in Node, never via a node-side unlocked account', () => {
		expect(script).toContain('window.__mockPersonalSign(');
		expect(script).toContain('window.__mockSignTypedData(');
		expect(script).not.toContain("'personal_sign', [");
		expect(script).not.toContain("'eth_signTypedData_v4', [");
	});

	it('sends transactions through the Node signer, never eth_sendTransaction', () => {
		expect(script).toContain('window.__mockSendTransaction(');
		expect(script).not.toContain("'eth_sendTransaction'");
	});

	it('keeps the account-switch hook and the EIP-6963 announcement the specs rely on', () => {
		expect(script).toContain('__mockWalletSwitchAccount');
		expect(script).toContain('eip6963:announceProvider');
		expect(script).toContain("rdns: 'io.metamask'");
	});
});
