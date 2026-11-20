import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useChatMutations from '@/hooks/useChatMutations';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { encryptData } from '@/lib/crypto';
import { blocksAction } from '@/lib/feeTokenCheck';

import useOneSendAtATime from './useOneSendAtATime';

vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		warning: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
	},
}));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn((options: { method: string }) => ({ method: options.method })),
	sendAndConfirmTransaction: vi.fn(),
}));
vi.mock('thirdweb/react', () => {
	const account = { address: '0x00000000000000000000000000000000000000aa' };
	const wallet = { getChain: () => ({ id: 31337 }), getAccount: () => account };
	return { useActiveAccount: () => account, useActiveWallet: () => wallet };
});
vi.mock('thirdweb/rpc', () => ({ eth_getTransactionReceipt: vi.fn(), getRpcClient: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', async () => {
	const agent = await import('@/lib/abi/EVMAIAgent.json');
	const escrow = await import('@/lib/abi/EVMAIAgentEscrow.json');
	return {
		LOCAL_CHAIN_ID: 31337,
		TESTNET_CHAIN_ID: 84532,
		CONTRACTS: {
			31337: {
				token: { address: '0x00000000000000000000000000000000000000c1', abi: [] },
				agent: { address: '0x00000000000000000000000000000000000000a9', abi: agent.abi },
				escrow: { address: '0x00000000000000000000000000000000000000e5', abi: escrow.abi },
			},
		},
	};
});
vi.mock('@/hooks/useFaucetConfig', () => ({ default: () => ({ data: { amount: 100 } }) }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/lib/faucetService', () => ({
	default: vi.fn(),
	awaitFaucetReceipt: vi.fn(),
	DEFAULT_FAUCET_AMOUNT: 100,
	FAUCET_POLL_MS: 2000,
	FAUCET_WAIT_ATTEMPTS: 30,
	FAUCET_WAIT_MS: 60000,
}));
vi.mock('@/lib/crypto', () => ({ encryptData: vi.fn(async () => 'iv.cipher') }));
vi.mock('@/lib/ecies', () => ({ default: vi.fn(async () => new Uint8Array([1, 2, 3, 4])) }));

const sessionKey = {} as CryptoKey;

type Sends = ReturnType<typeof useOneSendAtATime>;

/** The three things the chat starts that send a paid prompt, started as the chat starts them. */
const SENDS: { name: string; start: (_m: Sends) => void }[] = [
	{
		name: 'saving an edited prompt',
		start: m =>
			m.initiatePromptMutation.mutate({
				conversationId: '1',
				promptText: 'hello again',
				sessionKey,
				parentId: 2,
				parentCID: 'cid-2',
			}),
	},
	{
		name: 'regenerating an answer',
		start: m =>
			m.regenerateMutation.mutate({
				conversationId: '1',
				promptMessageId: '2',
				originalAnswerMessageId: '3',
				instructions: 'better',
				sessionKey,
				promptMessageCID: 'cid-2',
				originalAnswerMessageCID: 'cid-3',
			}),
	},
	{
		name: 'branching a conversation',
		start: m =>
			m.branchConversationMutation.mutate({
				originalConversationId: '1',
				branchPointMessageId: '3',
				originalTitle: 'Title',
				sessionKey,
			}),
	},
];

/** Holds every transaction at "sent, not yet confirmed" until `confirm` is called. */
let confirm: () => void = () => undefined;

function renderSends() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useOneSendAtATime(useChatMutations()), { wrapper }).result;
}

/** Lets a send that was started get as far as it would: encrypted, prepared and sent. */
async function settleStarts() {
	await act(async () => {
		await new Promise(resolve => {
			setTimeout(resolve, 20);
		});
	});
}

/** Everything a send does on its way to the wallet, counted. */
const counts = () => ({
	encrypted: vi.mocked(encryptData).mock.calls.length,
	prepared: vi.mocked(prepareContractCall).mock.calls.length,
	sent: vi.mocked(sendAndConfirmTransaction).mock.calls.length,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict: 'ok',
		blocks: action => blocksAction('ok', action),
	});
	// Sent and waiting for its receipt. Confirmed with no event, the send then fails, which is
	// enough to end it.
	vi.mocked(sendAndConfirmTransaction).mockImplementation(
		() =>
			new Promise(resolve => {
				confirm = () => resolve({ logs: [] } as never);
			}) as never,
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const pairs = SENDS.flatMap(first => SENDS.map(second => ({ first, second })));

describe('a second send started while the first is pending', () => {
	it.each(pairs.map(({ first, second }) => [second.name, first.name, first, second] as const))(
		'%s while %s is pending prepares no second transaction',
		async (_second, _first, first, second) => {
			const sends = renderSends();
			await act(async () => {
				first.start(sends.current);
			});
			await waitFor(() => expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1));
			const afterFirst = counts();

			await act(async () => {
				second.start(sends.current);
			});
			await settleStarts();

			expect(counts()).toEqual(afterFirst);
		},
	);

	it.each(SENDS)('$name pressed twice in the same moment sends once', async ({ start }) => {
		const sends = renderSends();

		await act(async () => {
			start(sends.current);
			start(sends.current);
		});
		await settleStarts();

		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});
});

describe('a send started after the first has ended', () => {
	it.each(SENDS)('$name is sent', async ({ start }) => {
		const sends = renderSends();
		await act(async () => {
			start(sends.current);
		});
		await waitFor(() => expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1));
		await act(async () => {
			confirm();
		});
		await waitFor(() => {
			const { initiatePromptMutation, regenerateMutation, branchConversationMutation } =
				sends.current;
			expect(
				[initiatePromptMutation, regenerateMutation, branchConversationMutation].map(
					m => m.isPending,
				),
			).toEqual([false, false, false]);
		});
		await settleStarts();

		await act(async () => {
			start(sends.current);
		});
		await settleStarts();

		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
	});
});
