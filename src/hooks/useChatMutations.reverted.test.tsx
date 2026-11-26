import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { sendAndConfirmTransaction } from 'thirdweb';
import { type AbiEvent, encodeEventTopics, getAbiItem } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useOneMetadataSend from '@/features/history/useOneMetadataSend';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
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

const ESCROW = '0x00000000000000000000000000000000000000e5';
const sessionKey = {} as CryptoKey;

type Mutations = ReturnType<typeof useChatMutations>;

/** A receipt for a transaction that was mined and then reverted: no logs, status reverted. */
const REVERTED = { status: 'reverted', logs: [] };

/** The escrow's `PaymentRefunded(escrowId)` log, as a receipt carries it. */
function paymentRefundedLog(escrowId: bigint, address = ESCROW) {
	const topics = encodeEventTopics({
		abi: [getAbiItem({ abi: EVMAIAgentEscrowABI.abi, name: 'PaymentRefunded' }) as AbiEvent],
		eventName: 'PaymentRefunded',
		args: { escrowId },
	} as never);
	return { address, topics, data: '0x' };
}

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

async function settle(run: (_m: Mutations) => Promise<unknown>) {
	const { result, invalidate } = render();
	let outcome: unknown;
	await act(async () => {
		outcome = await run(result.current.mutations).then(
			() => 'resolved',
			(error: unknown) => error,
		);
	});
	return { outcome, invalidate };
}

const wasRefreshed = (invalidate: ReturnType<typeof vi.spyOn>) =>
	expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usagePlan'] });

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
	vi.mocked(sendAndConfirmTransaction).mockResolvedValue(REVERTED as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const errorTitles = () => vi.mocked(toast.error).mock.calls.map(([title]) => title);

describe('a cancellation that was mined and reverted', () => {
	it('fails, says nothing was cancelled, and refreshes the plan and balance', async () => {
		const { outcome, invalidate } = await settle(m =>
			m.cancelPromptMutation.mutateAsync({ answerMessageId: '3' }),
		);

		expect(outcome).toBeInstanceOf(Error);
		expect(toast.success).not.toHaveBeenCalled();
		expect(errorTitles()).toEqual(['Not Cancelled']);
		const [, options] = vi.mocked(toast.error).mock.calls[0];
		expect((options as { description: string }).description).toMatch(/nothing was cancelled/i);
		wasRefreshed(invalidate);
	});
});

describe('a refund that was mined and reverted', () => {
	it('fails and says nothing was refunded', async () => {
		const { outcome, invalidate } = await settle(m =>
			m.processRefundMutation.mutateAsync({ answerMessageId: '3' }),
		);

		expect(outcome).toBeInstanceOf(Error);
		expect(toast.success).not.toHaveBeenCalled();
		expect(errorTitles()).toEqual(['No Refund Paid']);
		wasRefreshed(invalidate);
	});
});

describe('a refund that succeeded on chain', () => {
	it('is called processed only when the escrow refunded this request', async () => {
		vi.mocked(sendAndConfirmTransaction).mockResolvedValue({
			status: 'success',
			logs: [paymentRefundedLog(3n)],
		} as never);

		const { outcome } = await settle(m =>
			m.processRefundMutation.mutateAsync({ answerMessageId: '3' }),
		);

		expect(outcome).toBe('resolved');
		expect(toast.success).toHaveBeenCalledWith('Refund Processed', expect.anything());
	});

	it.each([
		['no refund log at all', []],
		['a refund of another request', [paymentRefundedLog(4n)]],
		[
			'a refund log from another contract',
			[paymentRefundedLog(3n, '0x00000000000000000000000000000000000000ff')],
		],
	])('with %s fails and says nothing was refunded', async (_name, logs) => {
		vi.mocked(sendAndConfirmTransaction).mockResolvedValue({ status: 'success', logs } as never);

		const { outcome } = await settle(m =>
			m.processRefundMutation.mutateAsync({ answerMessageId: '3' }),
		);

		expect(outcome).toBeInstanceOf(Error);
		expect(toast.success).not.toHaveBeenCalled();
		expect(errorTitles()).toEqual(['Nothing Refunded']);
	});
});

describe('a rename or delete that was mined and reverted', () => {
	it.each([
		['rename', false],
		['delete', true],
	])('a %s is not saved on this device', async (_name, isDeleted) => {
		const { result, invalidate } = render();
		const onSaved = vi.fn(async () => undefined);

		await act(async () => {
			result.current.sendMetadata(
				{ conversationId: '1', title: 'Title', isDeleted, sessionKey },
				onSaved,
			);
			// Settled either way: an error shown, or the change saved here.
			await vi.waitFor(() =>
				expect(vi.mocked(toast.error).mock.calls.length + onSaved.mock.calls.length).toBe(1),
			);
		});

		expect(onSaved).not.toHaveBeenCalled();
		expect(errorTitles()).toEqual(['Not Changed']);
		wasRefreshed(invalidate);
	});
});

describe('a paid send that was mined and reverted', () => {
	it.each([
		[
			'a prompt',
			(m: Mutations) =>
				m.initiatePromptMutation.mutateAsync({
					conversationId: '1',
					promptText: 'hello',
					sessionKey,
					parentId: 2,
					parentCID: 'cid-2',
				}),
		],
		[
			'a regenerate',
			(m: Mutations) =>
				m.regenerateMutation.mutateAsync({
					conversationId: '1',
					promptMessageId: '2',
					originalAnswerMessageId: '3',
					instructions: '',
					sessionKey,
					promptMessageCID: 'cid-2',
					originalAnswerMessageCID: 'cid-3',
				}),
		],
		[
			'a branch',
			(m: Mutations) =>
				m.branchConversationMutation.mutateAsync({
					originalConversationId: '1',
					branchPointMessageId: '3',
					originalTitle: 'Title',
					sessionKey,
				}),
		],
	])('%s says it was not sent', async (_name, run) => {
		const { outcome, invalidate } = await settle(run);

		expect(outcome).toBeInstanceOf(Error);
		expect(errorTitles()).toEqual(['Not Sent']);
		wasRefreshed(invalidate);
	});
});
