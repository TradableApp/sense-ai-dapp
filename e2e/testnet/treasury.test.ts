import { decodeFunctionData, parseAbi } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepAccount, TOKEN_PER_ACCOUNT_WEI } from './treasury';
import type { TestnetConfig } from '../helpers/chain';

type Tx = { to: string; data?: `0x${string}`; value?: bigint };

const TOKEN = '0xD77FF82e661C3838a59ea78bbF31F8c4c2BD8A80';
const TREASURY = '0xA0AbBe63967f1EDF753Ad7557904Ef1410179c6B';
const ACCOUNT = '0x5d8130b7ddd4455CEaA0Da5C3036aC4D8d7e0685';
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000f';
const ERC20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

const hex = (n: bigint) => `0x${n.toString(16)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;

const cfg: TestnetConfig = {
	chain: 'testnet',
	chainId: 84532,
	rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/not-a-real-key',
	tokenAddress: TOKEN,
	escrowAddress: '0x36ec08471F2b995024967204D7542713cFaf5Fa4',
	agentAddress: '0x4a0C7e5807f9174499a8F56F2C69c61b39a4c64D',
	baseUrl: 'https://sense-ai-app-garrick.web.app',
	treasuryAddress: TREASURY,
	treasuryPrivateKey: `0x${'11'.repeat(32)}`,
	seed: 'ab'.repeat(32),
	accountsFile: '/tmp/accounts.json',
	prefundedCount: 1,
};

/** Token balance answers, consumed one per `balanceOf` read — a second read sees the next one. */
const tokenReads: bigint[] = [];
const rpc = vi.fn(async (method: string, params: unknown[] = []) => {
	if (method === 'eth_gasPrice') return hex(5_000_000n);
	if (method === 'eth_getBalance') return hex(5n * 10n ** 14n);
	if (method === 'eth_call') {
		const { to } = params[0] as { to: string };
		if (to.toLowerCase() === GAS_PRICE_ORACLE) return word(15_600_000n);
		if (to.toLowerCase() === TOKEN.toLowerCase()) return word(tokenReads.shift() ?? 0n);
	}
	throw new Error(`unexpected rpc ${method}`);
});
const sendFrom = vi.fn<(_tx: Tx) => Promise<string>>(async () => `0x${'ee'.repeat(32)}`);

vi.mock('../helpers/chain', () => ({
	getChainConfig: () => cfg,
	rpc: (...args: unknown[]) => rpc(...(args as [string, unknown[]])),
	sendFrom: (tx: Tx) => sendFrom(tx),
}));

const tokenTransfers = () =>
	sendFrom.mock.calls
		.map(([tx]) => tx)
		.filter(tx => tx.to === TOKEN && tx.data !== undefined)
		.map(tx => decodeFunctionData({ abi: ERC20, data: tx.data as `0x${string}` }));

describe('sweepAccount', () => {
	beforeEach(() => {
		rpc.mockClear();
		sendFrom.mockClear();
		tokenReads.length = 0;
	});

	it('transfers the token balance it planned with — one read, not a second one that may differ', async () => {
		// The planned read sees 5 ABLE; a hypothetical second read would see 0 (another sweeper got
		// there first). The transfer must move what the plan was built on, so `sendToken: true` in
		// the returned plan is never paired with a 0-amount transfer.
		tokenReads.push(TOKEN_PER_ACCOUNT_WEI, 0n);

		const plan = await sweepAccount(ACCOUNT);

		expect(plan.sendToken).toBe(true);
		const balanceReads = rpc.mock.calls.filter(
			([method, params]) =>
				method === 'eth_call' &&
				(params as [{ to: string }])[0].to.toLowerCase() === TOKEN.toLowerCase(),
		);
		expect(balanceReads).toHaveLength(1);
		expect(tokenTransfers()).toEqual([
			{ functionName: 'transfer', args: [TREASURY, TOKEN_PER_ACCOUNT_WEI] },
		]);
	});

	it('skips the token transfer when the account holds none', async () => {
		tokenReads.push(0n);

		const plan = await sweepAccount(ACCOUNT);

		expect(plan.sendToken).toBe(false);
		expect(tokenTransfers()).toEqual([]);
	});
});
