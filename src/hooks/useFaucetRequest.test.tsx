import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt } from 'thirdweb/rpc';
import { encodeAbiParameters, keccak256, pad, parseUnits, stringToBytes } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN } from '@/config/feeToken';
import requestTestTokens from '@/lib/faucetService';

import useFaucetRequest, { forgetFaucetReports } from './useFaucetRequest';

const TOKEN = '0x00000000000000000000000000000000000000C1';
const USER = '0x00000000000000000000000000000000000000AA';
const SOMEONE_ELSE = '0x0000000000000000000000000000000000000001';
const TX = '0xfeed';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
		warning: vi.fn(),
		loading: vi.fn(() => 'loading'),
		dismiss: vi.fn(),
	},
}));
vi.mock('thirdweb/react', () => {
	const wallet = { getChain: () => ({ id: 31337 }), getAccount: () => ({ address: USER }) };
	return { useActiveWallet: () => wallet };
});
vi.mock('thirdweb/rpc', () => ({ eth_getTransactionReceipt: vi.fn(), getRpcClient: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	LOCAL_CHAIN_ID: 31337,
	CONTRACTS: { 31337: { token: { address: '0x00000000000000000000000000000000000000C1' } } },
}));
vi.mock('@/hooks/useFaucetConfig', () => ({ default: () => ({ data: { amount: 100 } }) }));
vi.mock('@/lib/utils', () => ({ wait: vi.fn(async () => undefined) }));
vi.mock('@/lib/faucetService', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/faucetService')>()),
	default: vi.fn(),
}));
vi.mock('@/config/firebase', () => ({ db: null, functions: null }));

const TRANSFER_TOPIC = keccak256(stringToBytes('Transfer(address,address,uint256)'));

function transferLog(token: string, to: string, whole: string) {
	return {
		address: token.toLowerCase(),
		topics: [TRANSFER_TOPIC, pad('0x01'), pad(to.toLowerCase() as `0x${string}`)],
		data: encodeAbiParameters([{ type: 'uint256' }], [parseUnits(whole, FEE_TOKEN.decimals)]),
	};
}

function minedWith(receipt: Record<string, unknown>) {
	vi.mocked(eth_getTransactionReceipt).mockResolvedValue(receipt as never);
}

async function requestTokens() {
	const queryClient = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(() => useFaucetRequest(), { wrapper });
	await act(async () => {
		await result.current.requestTokens();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	forgetFaucetReports();
	// The faucet says it sent 100; only the receipt says what arrived.
	vi.mocked(requestTestTokens).mockResolvedValue({ success: true, txHash: TX, amount: 100 });
});

afterEach(() => {
	cleanup();
});

describe('useFaucetRequest', () => {
	it('announces the amount the receipt shows arriving, not the amount asked for', async () => {
		minedWith({ status: 'success', logs: [transferLog(TOKEN, USER, '250')] });

		await requestTokens();

		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(toast.success).toHaveBeenCalledWith('Tokens Received', {
			description: `250 ${FEE_TOKEN.symbol} added to your wallet.`,
		});
	});

	it('announces nothing received for a reverted receipt', async () => {
		minedWith({ status: 'reverted', logs: [transferLog(TOKEN, USER, '100')] });

		await requestTokens();

		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Tokens Not Received', expect.any(Object));
	});

	it('says so plainly when a successful receipt carries no tokens to the user', async () => {
		minedWith({
			status: 'success',
			logs: [transferLog(TOKEN, SOMEONE_ELSE, '100')],
		});

		await requestTokens();

		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(
			'Tokens Not Received',
			expect.objectContaining({ description: expect.stringMatching(/no tokens arrived/i) }),
		);
	});

	it('reports a successful receipt with no tokens once per page load', async () => {
		minedWith({ status: 'success', logs: [] });

		await requestTokens();
		await requestTokens();

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		expect(Sentry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: expect.objectContaining({ check: 'faucet' }) }),
		);
	});

	it('does not report a receipt that brought the tokens', async () => {
		minedWith({ status: 'success', logs: [transferLog(TOKEN, USER, '100')] });

		await requestTokens();

		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it('says the transfer is still confirming when no receipt comes in time', async () => {
		vi.mocked(eth_getTransactionReceipt).mockRejectedValue(
			new Error('Transaction receipt not found.'),
		);

		await requestTokens();

		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.info).toHaveBeenCalledWith('Still Confirming', expect.any(Object));
	});

	it('waits for nothing when the faucet sent nothing', async () => {
		vi.mocked(requestTestTokens).mockResolvedValue({ success: false });

		await requestTokens();

		expect(eth_getTransactionReceipt).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});
});
