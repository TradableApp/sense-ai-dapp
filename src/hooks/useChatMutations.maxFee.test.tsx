import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { encryptData } from '@/lib/crypto';
import eciesEncrypt from '@/lib/ecies';
import { type EscrowFeeKind, FeeNotReadError, readEscrowFee } from '@/lib/escrowFee';

import useChatMutations from './useChatMutations';

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
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn() }));
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
vi.mock('@/lib/escrowFee', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/escrowFee')>()),
	readEscrowFee: vi.fn(),
}));

const sessionKey = {} as CryptoKey;
const ESCROW = '0x00000000000000000000000000000000000000e5';

// A different fee per kind, so a call that passed the wrong kind's fee is told apart.
const FEES: Record<EscrowFeeKind, bigint> = {
	prompt: 11n,
	branch: 22n,
	metadata: 33n,
	cancellation: 44n,
};

type Mutations = ReturnType<typeof useChatMutations>;

/** Every call that takes a maximum fee, the fee it must read, and how it is started. */
const CALLS: {
	name: string;
	method: string;
	kind: EscrowFeeKind;
	encrypts: boolean;
	run: (_m: Mutations) => Promise<unknown>;
}[] = [
	{
		name: 'send a prompt',
		method: 'initiatePrompt',
		kind: 'prompt',
		encrypts: true,
		run: m =>
			m.initiatePromptMutation.mutateAsync({
				conversationId: '1',
				promptText: 'hello',
				sessionKey,
				parentId: 2,
				parentCID: 'cid-2',
			}),
	},
	{
		name: 'regenerate an answer',
		method: 'initiateRegeneration',
		kind: 'prompt',
		encrypts: true,
		run: m =>
			m.regenerateMutation.mutateAsync({
				conversationId: '1',
				promptMessageId: '2',
				originalAnswerMessageId: '3',
				instructions: '',
				sessionKey,
				promptMessageCID: 'cid-2',
				originalAnswerMessageCID: 'cid-3',
			}),
	},
	{
		name: 'branch a conversation',
		method: 'initiateBranch',
		kind: 'branch',
		encrypts: true,
		run: m =>
			m.branchConversationMutation.mutateAsync({
				originalConversationId: '1',
				branchPointMessageId: '3',
				originalTitle: 'Title',
				sessionKey,
			}),
	},
	{
		name: 'rename a conversation',
		method: 'initiateMetadataUpdate',
		kind: 'metadata',
		encrypts: true,
		run: m =>
			m.metadataUpdateMutation.mutateAsync({
				conversationId: '1',
				title: 'New title',
				isDeleted: false,
				sessionKey,
			}),
	},
	{
		name: 'cancel a prompt',
		method: 'cancelPrompt',
		kind: 'cancellation',
		encrypts: false,
		run: m => m.cancelPromptMutation.mutateAsync({ answerMessageId: '3' }),
	},
];

function renderMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useChatMutations(), { wrapper }).result;
}

async function attempt(run: (_m: Mutations) => Promise<unknown>): Promise<void> {
	const result = renderMutations();
	await act(async () => {
		await run(result.current).catch(() => undefined);
	});
}

const preparedCall = () =>
	vi.mocked(prepareContractCall).mock.calls[0]?.[0] as unknown as {
		method: string;
		params: unknown[];
	};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useFeeTokenCheck).mockReturnValue({ verdict: 'ok', blocks: () => false });
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
	vi.mocked(readEscrowFee).mockImplementation(async (_chain, _escrow, kind) => FEES[kind]);
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(sendAndConfirmTransaction).mockResolvedValue({ logs: [] } as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('the most a call agrees to pay', () => {
	it.each(CALLS)(
		'$name reads its own fee from the escrow and passes it as the last argument',
		async ({ run, method, kind }) => {
			await attempt(run);

			expect(readEscrowFee).toHaveBeenCalledTimes(1);
			expect(readEscrowFee).toHaveBeenCalledWith(expect.anything(), ESCROW, kind);
			expect(preparedCall().method).toBe(method);
			expect(preparedCall().params.at(-1)).toBe(FEES[kind]);
			expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
		},
	);

	// The argument count is the contract's: one short and the call cannot be encoded.
	it.each([
		['send a prompt', 4],
		['regenerate an answer', 6],
		['branch a conversation', 5],
		['rename a conversation', 4],
		['cancel a prompt', 2],
	])('%s passes %i arguments', async (name, count) => {
		const call = CALLS.find(c => c.name === name);

		await attempt(call!.run);

		expect(preparedCall().params).toHaveLength(count);
	});

	it('a fee of zero is passed as zero', async () => {
		vi.mocked(readEscrowFee).mockResolvedValue(0n);

		await attempt(CALLS[0].run);

		expect(preparedCall().params.at(-1)).toBe(0n);
	});
});

describe('a fee that could not be read', () => {
	beforeEach(() => {
		vi.mocked(readEscrowFee).mockImplementation(async (_chain, _escrow, kind) => {
			throw new FeeNotReadError(kind);
		});
	});

	it.each(CALLS)('$name: nothing is encrypted, prepared or sent', async ({ run }) => {
		await attempt(run);

		expect(encryptData).not.toHaveBeenCalled();
		expect(eciesEncrypt).not.toHaveBeenCalled();
		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirmTransaction).not.toHaveBeenCalled();
	});

	it.each(CALLS.filter(call => call.kind !== 'cancellation'))(
		'$name: the user is told nothing was sent and no tokens were taken',
		async ({ run }) => {
			await attempt(run);

			expect(toast.error).toHaveBeenCalledTimes(1);
			const [title, options] = vi.mocked(toast.error).mock.calls[0];
			expect(title).toBe('Not Sent');
			expect(String((options as { description?: unknown }).description)).toMatch(
				/fee could not be read.*nothing was sent.*no tokens were taken/i,
			);
		},
	);

	it('cancel a prompt: the user is told nothing was cancelled', async () => {
		await attempt(CALLS.find(call => call.kind === 'cancellation')!.run);

		expect(toast.error).toHaveBeenCalledTimes(1);
		const [title, options] = vi.mocked(toast.error).mock.calls[0];
		expect(title).toBe('Could Not Cancel');
		expect(String((options as { description?: unknown }).description)).toMatch(
			/cancellation fee could not be read.*nothing was cancelled/i,
		);
	});
});

describe('a cancel that went through', () => {
	// The escrow keeps the fee out of the payment it held and sends back the rest.
	it('says the payment came back less the cancellation fee', async () => {
		await attempt(CALLS.find(call => call.kind === 'cancellation')!.run);

		expect(toast.success).toHaveBeenCalledWith('Prompt Cancelled', {
			description: expect.stringMatching(/returned.*less the cancellation fee/i),
		});
	});
});
