import { httpsCallable } from 'firebase/functions';
import { decodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import requestTestTokens from './faucetService';

// Hardhat account #0 — the deployer/treasury that holds the full ABLE supply and
// is unlocked on the local node, so eth_sendTransaction needs no signature.
const HARDHAT_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TOKEN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RPC_URL = 'http://127.0.0.1:8545';

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('VITE_CHAIN_RPC_URL', RPC_URL);
	vi.stubEnv('VITE_TOKEN_CONTRACT_ADDRESS', TOKEN);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('requestTestTokens — localnet (deployer transfer, no cloud function)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_CHAIN_ID', '31337');
	});

	it('transfers ABLE from the unlocked deployer via RPC and returns the tx hash', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xdeadbeef' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestTestTokens(USER);

		expect(result).toEqual({ success: true, txHash: '0xdeadbeef' });

		// Hit the local RPC, not Firebase.
		expect(httpsCallable).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(RPC_URL);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.method).toBe('eth_sendTransaction');
		const tx = body.params[0];
		expect(tx.from.toLowerCase()).toBe(HARDHAT_DEPLOYER.toLowerCase());
		expect(tx.to.toLowerCase()).toBe(TOKEN.toLowerCase());

		// Calldata must be a transfer(user, 100e18).
		const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
		expect(decoded.functionName).toBe('transfer');
		expect((decoded.args[0] as string).toLowerCase()).toBe(USER.toLowerCase());
		expect(decoded.args[1]).toBe(parseUnits('100', 18));
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
});

describe('requestTestTokens — testnet (Firebase callable, unchanged)', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_CHAIN_ID', '84532');
	});

	it('calls the requestTestTokens cloud function and never hits the RPC', async () => {
		const callable = vi.fn().mockResolvedValue({ data: { success: true, txHash: '0xfromfirebase' } });
		(httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(callable);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestTestTokens(USER);

		expect(result).toEqual({ success: true, txHash: '0xfromfirebase' });
		expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'requestTestTokens');
		expect(callable).toHaveBeenCalledWith({ walletAddress: USER });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
