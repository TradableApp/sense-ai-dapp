import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
// eslint-disable-next-line camelcase
import { eth_getTransactionReceipt, getRpcClient } from 'thirdweb/rpc';
import { encodeAbiParameters, keccak256, pad, parseUnits, stringToBytes } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UPDATE_TOAST_ID } from '@/components/UpdatePrompt';
import { FEE_TOKEN } from '@/config/feeToken';
import requestTestTokens from '@/lib/faucetService';

import useFaucetRequest, { FAUCET_OFFER_TOAST_ID, forgetFaucetReports } from './useFaucetRequest';

const TOKEN = '0x00000000000000000000000000000000000000C1';
const USER = '0x00000000000000000000000000000000000000AA';
const SOMEONE_ELSE = '0x0000000000000000000000000000000000000001';
const TX = '0xfeed';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		// Each toast that is taken down later needs an id, as sonner gives one.
		info: vi.fn(() => 'sent'),
		warning: vi.fn(),
		loading: vi.fn(() => 'loading'),
		dismiss: vi.fn(),
	},
}));
// The chain the wallet is on, changeable between render and request.
const walletChain = vi.hoisted(() => ({ id: 31337 }));
vi.mock('thirdweb/react', () => {
	const wallet = {
		getChain: () => ({ id: walletChain.id }),
		getAccount: () => ({ address: '0x00000000000000000000000000000000000000AA' }),
	};
	return { useActiveWallet: () => wallet };
});
vi.mock('thirdweb/rpc', () => ({ eth_getTransactionReceipt: vi.fn(), getRpcClient: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	LOCAL_CHAIN_ID: 31337,
	CONTRACTS: {
		31337: { token: { address: '0x00000000000000000000000000000000000000C1' } },
		84532: { token: { address: '0x00000000000000000000000000000000000000B2' } },
		// A chain this build has no token for.
		99: {},
	},
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

type Faucet = ReturnType<typeof useFaucetRequest>;

/** Asks for tokens the way one place does: the plan dialog's button unless told otherwise. */
async function requestTokens(start: (_f: Faucet) => Promise<void> = f => f.requestTokens()) {
	const queryClient = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(() => useFaucetRequest(), { wrapper });
	await act(async () => {
		await start(result.current);
	});
}

/** Whether any call closed every toast at once (sonner's dismiss with no id). */
const closedEveryToast = () =>
	vi.mocked(toast.dismiss).mock.calls.some(call => call.length === 0 || call[0] === undefined);

beforeEach(() => {
	vi.clearAllMocks();
	walletChain.id = 31337;
	forgetFaucetReports();
	// The faucet says it sent 100; only the receipt says what arrived.
	vi.mocked(requestTestTokens).mockResolvedValue({ success: true, txHash: TX, amount: 100 });
});

afterEach(() => {
	cleanup();
});

// A dismissal of every toast also takes down notices the faucet did not raise, and the
// update prompt reads a dismissal it did not cause as the user declining the new version.
describe('which toasts a faucet request closes', () => {
	it('closes no other toast when asked from the plan dialog', async () => {
		minedWith({ status: 'success', logs: [transferLog(TOKEN, USER, '100')] });

		await requestTokens();

		expect(closedEveryToast()).toBe(false);
		expect(toast.dismiss).not.toHaveBeenCalledWith(FAUCET_OFFER_TOAST_ID);
		expect(toast.dismiss).not.toHaveBeenCalledWith(UPDATE_TOAST_ID);
	});

	it('closes only the toast that offered the faucet when asked from it', async () => {
		minedWith({ status: 'success', logs: [transferLog(TOKEN, USER, '100')] });

		await requestTokens(f => f.requestTokensFromOffer());

		expect(closedEveryToast()).toBe(false);
		expect(toast.dismiss).toHaveBeenCalledWith(FAUCET_OFFER_TOAST_ID);
		expect(toast.dismiss).not.toHaveBeenCalledWith(UPDATE_TOAST_ID);
	});

	it('closes no other toast when the faucet sends nothing', async () => {
		vi.mocked(requestTestTokens).mockResolvedValue({ success: false });

		await requestTokens(f => f.requestTokensFromOffer());

		expect(closedEveryToast()).toBe(false);
	});
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

describe('a faucet request on a build with no token for the chain', () => {
	it('asks the faucet for nothing and says the faucet is not available', async () => {
		walletChain.id = 99;

		await requestTokens();

		expect(requestTestTokens).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith('Faucet Not Available', expect.any(Object));
	});

	it('reports a setup fault, not a faucet that sent nothing', async () => {
		walletChain.id = 99;

		await requestTokens();

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(String(error)).toMatch(/no fee token is configured/i);
		expect(context).toEqual(
			expect.objectContaining({ tags: expect.objectContaining({ check: 'faucet' }) }),
		);
	});
});

describe('the chain a faucet request uses', () => {
	const TOKEN_B = '0x00000000000000000000000000000000000000B2';

	it('is the one the wallet is on when the request is made, for the receipt and the balance', async () => {
		minedWith({ status: 'success', logs: [transferLog(TOKEN_B, USER, '7')] });
		const queryClient = new QueryClient();
		const refreshed = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(() => useFaucetRequest(), { wrapper });

		walletChain.id = 84532;
		await act(async () => {
			await result.current.requestTokens();
		});

		expect(toast.success).toHaveBeenCalledWith('Tokens Received', {
			description: `7 ${FEE_TOKEN.symbol} added to your wallet.`,
		});
		const [[{ queryKey }]] = refreshed.mock.calls as unknown as [[{ queryKey: unknown[] }]];
		expect(queryKey).toContain(84532);
	});
});

describe('when a faucet request refreshes the balance', () => {
	async function refreshesAfter(prepare: () => void): Promise<boolean> {
		prepare();
		const queryClient = new QueryClient();
		const refreshed = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(() => useFaucetRequest(), { wrapper });
		await act(async () => {
			await result.current.requestTokens();
		});
		return refreshed.mock.calls.length > 0;
	}

	it('refreshes it when the tokens arrived', async () => {
		const refreshed = await refreshesAfter(() =>
			minedWith({ status: 'success', logs: [transferLog(TOKEN, USER, '5')] }),
		);

		expect(refreshed).toBe(true);
	});

	it('refreshes it while the transfer is still confirming', async () => {
		const refreshed = await refreshesAfter(() =>
			vi
				.mocked(eth_getTransactionReceipt)
				.mockRejectedValue(new Error('Transaction receipt not found.')),
		);

		expect(refreshed).toBe(true);
	});

	it.each([
		['the receipt reverted', { status: 'reverted', logs: [] }],
		['the receipt brought the user nothing', { status: 'success', logs: [] }],
	])('leaves it alone when %s', async (_, receipt) => {
		const refreshed = await refreshesAfter(() => minedWith(receipt));

		expect(refreshed).toBe(false);
	});
});

describe('a faucet call that fails outright', () => {
	it('takes the loading notice down, says so, announces nothing and refreshes nothing', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(requestTestTokens).mockRejectedValue(new Error('network down'));
		const queryClient = new QueryClient();
		const refreshed = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
		const { result } = renderHook(() => useFaucetRequest(), { wrapper });

		await act(async () => {
			await expect(result.current.requestTokens()).resolves.toBeUndefined();
		});

		expect(toast.dismiss).toHaveBeenCalledWith('loading');
		expect(toast.error).toHaveBeenCalledWith('Faucet Failed', expect.any(Object));
		expect(toast.success).not.toHaveBeenCalled();
		expect(refreshed).not.toHaveBeenCalled();
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});
});

describe('a wait for the receipt that fails', () => {
	it('replaces the sent notice with a plain failure, announces nothing and logs it', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(getRpcClient).mockImplementationOnce(() => {
			throw new Error('no RPC for this chain');
		});

		await requestTokens();

		expect(toast.dismiss).toHaveBeenCalledWith('sent');
		expect(toast.error).toHaveBeenCalledWith(
			'Transfer Not Confirmed',
			expect.objectContaining({ description: expect.stringMatching(/check your balance/i) }),
		);
		expect(toast.success).not.toHaveBeenCalled();
		expect(logged).toHaveBeenCalled();
		// The sent notice goes first, as it does when the wait succeeds.
		const dismissedAt = vi.mocked(toast.dismiss).mock.invocationCallOrder[
			vi.mocked(toast.dismiss).mock.calls.findIndex(([id]) => id === 'sent')
		];
		expect(dismissedAt).toBeLessThan(vi.mocked(toast.error).mock.invocationCallOrder[0]);
		logged.mockRestore();
	});
});
