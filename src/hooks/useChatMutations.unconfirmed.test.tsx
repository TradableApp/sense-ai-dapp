import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { sendAndConfirmTransaction } from 'thirdweb';
import { decodeEventLog } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useOneMetadataSend from '@/features/history/useOneMetadataSend';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { blocksAction } from '@/lib/feeTokenCheck';

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
vi.mock('viem', async importOriginal => {
	const actual = await importOriginal<typeof import('viem')>();
	return { ...actual, decodeEventLog: vi.fn(actual.decodeEventLog) };
});
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
vi.mock('@/features/auth/SessionProvider', async importOriginal => ({
	...(await importOriginal<typeof import('@/features/auth/SessionProvider')>()),
	useSession: () => ({ ownerAddress: '0x00000000000000000000000000000000000000aa' }),
}));
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

const OWNER = '0x00000000000000000000000000000000000000aa';
const sessionKey = {} as CryptoKey;

/** thirdweb's rejection when no receipt has come within its wait: the transaction was sent. */
const NOT_FOUND = new Error(
	`Transaction receipt for 0x${'ab'.repeat(32)} not found after 100 blocks`,
);

type Mutations = ReturnType<typeof useChatMutations>;

function render() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(
		() => {
			const mutations = useChatMutations();
			const sendMetadata = useOneMetadataSend(mutations.metadataUpdateMutation.mutate);
			return { mutations, sendMetadata };
		},
		{ wrapper },
	);
	return { result, invalidate };
}

/**
 * Starts the mutation `pick` names with `variables`, as the chat does (`mutate`, with its own
 * `onSuccess`), and gives back what it settled with and whether that `onSuccess` ran.
 */
async function settle(
	pick: (_m: Mutations) => {
		mutate: (_v: never, _o: { onSuccess: () => void; onError: (_e: unknown) => void }) => void;
	},
	variables: unknown,
) {
	const { result, invalidate } = render();
	const onSuccess = vi.fn();
	let outcome: unknown;
	await act(async () => {
		await new Promise<void>(done => {
			pick(result.current.mutations).mutate(variables as never, {
				onSuccess: () => {
					onSuccess();
					done();
				},
				onError: error => {
					outcome = error;
					done();
				},
			});
		});
	});
	return { outcome, onSuccess, invalidate };
}

const PROMPT = {
	conversationId: '1',
	promptText: 'hello',
	sessionKey,
	parentId: 2,
	parentCID: 'cid-2',
};
const REGENERATE = {
	conversationId: '1',
	promptMessageId: '2',
	originalAnswerMessageId: '3',
	instructions: '',
	sessionKey,
	promptMessageCID: 'cid-2',
	originalAnswerMessageCID: 'cid-3',
};
const BRANCH = {
	originalConversationId: '1',
	branchPointMessageId: '3',
	originalTitle: 'Title',
	sessionKey,
};

const warned = () => vi.mocked(toast.warning).mock.calls;

/** The one notice shown: a warning, with this title, and no error or success beside it. */
function expectOneWarning(title: string): string {
	expect(toast.error).not.toHaveBeenCalled();
	expect(toast.success).not.toHaveBeenCalled();
	expect(warned().map(([shown]) => shown)).toEqual([title]);
	const [, options] = warned()[0];
	const { description } = options as { description: string };
	expect(description).toMatch(/not confirmed yet/i);
	expect(description).not.toMatch(/fail/i);
	return description;
}

function expectTypedOutcome(outcome: unknown, action: string) {
	expect(outcome).toBeInstanceOf(Error);
	expect((outcome as Error).name).toBe('TransactionNotConfirmedError');
	expect((outcome as { action?: string }).action).toBe(action);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict: 'ok',
		blocks: action => blocksAction('ok', action),
	});
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(sendAndConfirmTransaction).mockRejectedValue(NOT_FOUND);
});

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

// The wait for a receipt is bounded; a transaction whose receipt has not come by then was sent
// and may still be mined. It is told as not confirmed, never as failed, and nothing after the
// send runs as if it had happened or as if it had not.
describe('a paid send whose receipt did not come', () => {
	it.each([
		[
			'a prompt',
			(m: Mutations) => m.initiatePromptMutation,
			PROMPT,
			'send message',
			[['messages', '1', OWNER]],
		],
		[
			'a regenerate',
			(m: Mutations) => m.regenerateMutation,
			REGENERATE,
			'regenerate response',
			[['messages', '1', OWNER]],
		],
		['a branch', (m: Mutations) => m.branchConversationMutation, BRANCH, 'branch conversation', []],
	])(
		'%s says it may still go through, and asks for the history again',
		async (_name, pick, variables, action, messageKeys) => {
			const { outcome, onSuccess, invalidate } = await settle(pick as never, variables);

			expectTypedOutcome(outcome, action);
			const description = expectOneWarning('Send Not Confirmed');
			expect(description).toMatch(/may still go through/i);
			expect(description).toMatch(/would pay again/i);
			expect(description).toMatch(/history/i);
			expect(onSuccess).not.toHaveBeenCalled();
			expect(decodeEventLog).not.toHaveBeenCalled();
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usagePlan'] });
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ['conversations', sessionKey, OWNER],
			});
			messageKeys.forEach(queryKey => expect(invalidate).toHaveBeenCalledWith({ queryKey }));
			expect(console.error).not.toHaveBeenCalled();
		},
	);

	it('a prompt that starts a conversation asks for the list, not for messages', async () => {
		const { invalidate } = await settle(m => m.initiatePromptMutation as never, {
			...PROMPT,
			conversationId: 0,
		});

		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations', sessionKey, OWNER] });
		const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
		expect(keys).not.toContain('messages');
	});
});

describe('a cancellation whose receipt did not come', () => {
	it('says the prompt may still be cancelled', async () => {
		const { outcome, onSuccess, invalidate } = await settle(m => m.cancelPromptMutation as never, {
			answerMessageId: '3',
		});

		expectTypedOutcome(outcome, 'cancel prompt');
		expect(expectOneWarning('Cancel Not Confirmed')).toMatch(/may still be cancelled/i);
		expect(onSuccess).not.toHaveBeenCalled();
		expect(decodeEventLog).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usagePlan'] });
	});
});

describe('a refund whose receipt did not come', () => {
	it('says the refund may still be paid, and reads the stuck requests again', async () => {
		const { outcome, onSuccess, invalidate } = await settle(m => m.processRefundMutation as never, {
			answerMessageId: '3',
		});

		expectTypedOutcome(outcome, 'process refund');
		expect(expectOneWarning('Refund Not Confirmed')).toMatch(/may still be paid/i);
		expect(onSuccess).not.toHaveBeenCalled();
		expect(decodeEventLog).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usagePlan'] });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stuckRequests'] });
	});
});

describe('a rename or delete whose receipt did not come', () => {
	it.each([
		['rename', false],
		['delete', true],
	])('a %s says it may still be applied and is not saved here', async (_name, isDeleted) => {
		const { result, invalidate } = render();
		const onSaved = vi.fn(async () => undefined);

		await act(async () => {
			result.current.sendMetadata(
				{ conversationId: '1', title: 'Title', isDeleted, sessionKey },
				onSaved,
			);
			await vi.waitFor(() =>
				expect(
					vi.mocked(toast.error).mock.calls.length + warned().length + onSaved.mock.calls.length,
				).toBe(1),
			);
		});

		expect(onSaved).not.toHaveBeenCalled();
		expect(expectOneWarning('Change Not Confirmed')).toMatch(/may still be applied/i);
		expect(decodeEventLog).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usagePlan'] });
	});
});
