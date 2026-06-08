import { getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { decodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import requestTestTokens, { getFaucetConfig } from './faucetService';

// Hardhat account #0 — the deployer/treasury that holds the full ABLE supply and
// is unlocked on the local node, so eth_sendTransaction needs no signature.
const HARDHAT_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RPC_URL = 'http://127.0.0.1:8545';

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/config/firebase', () => ({ functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(() => ({})), getDoc: vi.fn() }));

/** Make getDoc(general/sense_ai) resolve to a config (or a missing doc). */
function stubFaucetConfig(faucet: Record<string, unknown> | null) {
	(getDoc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
		exists: () => faucet !== null,
		data: () => (faucet ? { faucet } : undefined),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('VITE_CHAIN_RPC_URL', RPC_URL);
	vi.stubEnv('VITE_TOKEN_CONTRACT_ADDRESS', TOKEN);
	stubFaucetConfig({ amount: 100, rateLimitHours: 24 });
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('getFaucetConfig', () => {
	it('returns the configured amount + rateLimitHours from general/sense_ai', async () => {
		stubFaucetConfig({ amount: 25, rateLimitHours: 12 });
		await expect(getFaucetConfig()).resolves.toEqual({ amount: 25, rateLimitHours: 12 });
	});

	it('falls back to defaults (100 / 24) when the doc or fields are missing', async () => {
		stubFaucetConfig(null);
		await expect(getFaucetConfig()).resolves.toEqual({ amount: 100, rateLimitHours: 24 });
	});

	it('sanitises a 0 / negative amount or rateLimit back to the default', async () => {
		stubFaucetConfig({ amount: 0, rateLimitHours: -5 });
		await expect(getFaucetConfig()).resolves.toEqual({ amount: 100, rateLimitHours: 24 });
	});

	it('sanitises a non-numeric or over-max amount back to the default', async () => {
		stubFaucetConfig({ amount: 'abc', rateLimitHours: 24 });
		await expect(getFaucetConfig()).resolves.toMatchObject({ amount: 100 });
		stubFaucetConfig({ amount: 999999, rateLimitHours: 24 });
		await expect(getFaucetConfig()).resolves.toMatchObject({ amount: 100 });
	});

	it('floors a fractional amount to whole ABLE', async () => {
		stubFaucetConfig({ amount: 50.9, rateLimitHours: 24 });
		await expect(getFaucetConfig()).resolves.toMatchObject({ amount: 50 });
	});
});

describe('requestTestTokens — localnet (deployer transfer, no cloud function)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_CHAIN_ID', '31337');
	});

	it('transfers the configured amount from the deployer and returns it with the tx hash', async () => {
		stubFaucetConfig({ amount: 50, rateLimitHours: 24 });
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xdeadbeef' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestTestTokens(USER);

		expect(result).toEqual({ success: true, txHash: '0xdeadbeef', amount: 50 });
		expect(httpsCallable).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls[0][0]).toBe(RPC_URL);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.method).toBe('eth_sendTransaction');
		const tx = body.params[0];
		expect(tx.from.toLowerCase()).toBe(HARDHAT_DEPLOYER.toLowerCase());
		expect(tx.to.toLowerCase()).toBe(TOKEN.toLowerCase());

		const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
		expect(decoded.functionName).toBe('transfer');
		expect((decoded.args[0] as string).toLowerCase()).toBe(USER.toLowerCase());
		expect(decoded.args[1]).toBe(parseUnits('50', 18));
	});

	it('returns { success: false } when the RPC rejects the transfer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'nonce too low' } }),
			}),
		);

		const result = await requestTestTokens(USER);

		expect(result.success).toBe(false);
		expect(httpsCallable).not.toHaveBeenCalled();
	});

	it('uses a caller-provided amount and skips the fresh config read', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xabc' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestTestTokens(USER, 30);

		expect(result).toEqual({ success: true, txHash: '0xabc', amount: 30 });
		expect(getDoc).not.toHaveBeenCalled(); // no second Firestore round-trip
		const decoded = decodeFunctionData({
			abi: erc20Abi,
			data: JSON.parse(fetchMock.mock.calls[0][1].body).params[0].data,
		});
		expect(decoded.args[1]).toBe(parseUnits('30', 18));
	});
});

describe('requestTestTokens — testnet (Firebase callable, unchanged)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_CHAIN_ID', '84532');
	});

	it('calls the cloud function, passes through its amount, and never hits the RPC', async () => {
		const callable = vi
			.fn()
			.mockResolvedValue({ data: { success: true, txHash: '0xfromfirebase', amount: 75 } });
		(httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(callable);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestTestTokens(USER);

		expect(result).toEqual({ success: true, txHash: '0xfromfirebase', amount: 75 });
		expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'requestTestTokens');
		expect(callable).toHaveBeenCalledWith({ walletAddress: USER });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
