import type { ReactNode } from 'react';

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import {
	type AbiEvent,
	type AbiParameter,
	encodeAbiParameters,
	encodeEventTopics,
	getAbiItem,
} from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useChatMutations from '@/hooks/useChatMutations';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import agentAbi from '@/lib/abi/EVMAIAgent.json';
import { encryptData } from '@/lib/crypto';
import { blocksAction } from '@/lib/feeTokenCheck';

import useOneSendAtATime, { forgetSaveFailureReports } from './useOneSendAtATime';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
const SESSION = vi.hoisted(() => ({
	sessionKey: {} as CryptoKey,
	ownerAddress: '0x00000000000000000000000000000000000000aa',
}));
vi.mock('@/features/auth/SessionProvider', () => ({ useSession: () => SESSION }));

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
const PROMPT_TEXT = 'hello again';
const AGENT_ADDRESS = '0x00000000000000000000000000000000000000a9';

type Sends = ReturnType<typeof useOneSendAtATime>;
/** What the chat passes to `mutate` besides the variables. */
type CallerCallbacks = {
	onSuccess?: () => void | Promise<void>;
	onSaveFailed?: () => void;
	onError?: () => void;
	onSettled?: () => void;
};

/**
 * The three things the chat starts that send a paid prompt, started as the chat starts them,
 * and the event that a confirmed one's receipt carries.
 */
const SENDS: { name: string; event: string; start: (_m: Sends, _o?: CallerCallbacks) => void }[] = [
	{
		name: 'saving an edited prompt',
		event: 'PromptSubmitted',
		start: (m, o) =>
			m.initiatePromptMutation.mutate(
				{
					conversationId: '1',
					promptText: PROMPT_TEXT,
					sessionKey,
					parentId: 2,
					parentCID: 'cid-2',
				},
				o,
			),
	},
	{
		name: 'regenerating an answer',
		event: 'RegenerationRequested',
		start: (m, o) =>
			m.regenerateMutation.mutate(
				{
					conversationId: '1',
					promptMessageId: '2',
					originalAnswerMessageId: '3',
					instructions: 'better',
					sessionKey,
					promptMessageCID: 'cid-2',
					originalAnswerMessageCID: 'cid-3',
				},
				o,
			),
	},
	{
		name: 'branching a conversation',
		event: 'BranchRequested',
		start: (m, o) =>
			m.branchConversationMutation.mutate(
				{
					originalConversationId: '1',
					branchPointMessageId: '3',
					originalTitle: 'Title',
					sessionKey,
				},
				o,
			),
	},
];

const SAMPLE_VALUES: Record<string, unknown> = {
	address: '0x00000000000000000000000000000000000000aa',
	uint256: 7n,
	bytes: '0x',
	string: '',
};

/** A receipt carrying the agent's `eventName`, as a confirmed send's receipt does. */
function receiptWith(eventName: string) {
	const event = getAbiItem({ abi: agentAbi.abi, name: eventName }) as AbiEvent;
	const indexed = event.inputs.filter(input => input.indexed);
	const plain = event.inputs.filter(input => !input.indexed) as AbiParameter[];
	const topics = encodeEventTopics({
		abi: [event],
		eventName,
		args: Object.fromEntries(indexed.map(input => [input.name, SAMPLE_VALUES[input.type]])),
	} as never);
	const data = encodeAbiParameters(
		plain,
		plain.map(input => SAMPLE_VALUES[input.type]),
	);
	return { logs: [{ address: AGENT_ADDRESS, topics, data }] };
}

/**
 * Holds every transaction at "sent, not yet confirmed" until `confirm` is called. Confirmed
 * with no receipt given, it carries no event and the send then fails.
 */
let confirm: (_receipt?: object) => void = () => undefined;

function newClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
}

function renderSends(queryClient = newClient()) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useOneSendAtATime(useChatMutations()), { wrapper });
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

/** Starts `start` and waits until its transaction is waiting for the wallet. */
async function startAndWait(sends: { current: Sends }, start: (_m: Sends) => void, sent = 1) {
	await act(async () => {
		start(sends.current);
	});
	await waitFor(() => expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(sent));
}

beforeEach(() => {
	vi.clearAllMocks();
	forgetSaveFailureReports();
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict: 'ok',
		blocks: action => blocksAction('ok', action),
	});
	vi.mocked(sendAndConfirmTransaction).mockImplementation(
		() =>
			new Promise(resolve => {
				confirm = (receipt = { logs: [] }) => resolve(receipt as never);
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
			const sends = renderSends().result;
			await startAndWait(sends, first.start);
			const afterFirst = counts();

			await act(async () => {
				second.start(sends.current);
			});
			await settleStarts();

			expect(counts()).toEqual(afterFirst);
		},
	);

	it.each(SENDS)('$name pressed twice in the same moment sends once', async ({ start }) => {
		const sends = renderSends().result;

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
		const sends = renderSends().result;
		await startAndWait(sends, start);
		await act(async () => {
			confirm();
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		await startAndWait(sends, start, 2);
	});
});

describe('isSending', () => {
	it.each(SENDS)('is false before, true while and false after $name', async ({ start }) => {
		const sends = renderSends().result;
		const before = sends.current.isSending;

		await startAndWait(sends, start);
		await waitFor(() => expect(sends.current.isSending).toBe(true));
		await act(async () => {
			confirm();
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		expect(before).toBe(false);
	});
});

describe('a send still waiting when the chat is left and opened again', () => {
	it.each(pairs.map(({ first, second }) => [second.name, first.name, first, second] as const))(
		'%s is refused while %s is still waiting, and shows as sending',
		async (_second, _first, first, second) => {
			const queryClient = newClient();
			const left = renderSends(queryClient);
			await startAndWait(left.result, first.start);
			left.unmount();

			const reopened = renderSends(queryClient).result;
			await act(async () => {
				second.start(reopened.current);
			});
			await settleStarts();

			expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
			expect(reopened.current.isSending).toBe(true);
		},
	);

	it.each(SENDS)('$name goes through once the first has ended', async ({ start }) => {
		const queryClient = newClient();
		const left = renderSends(queryClient);
		await startAndWait(left.result, start);
		left.unmount();
		const reopened = renderSends(queryClient).result;

		await act(async () => {
			confirm();
		});
		await waitFor(() => expect(reopened.current.isSending).toBe(false));

		await startAndWait(reopened, start, 2);
	});
});

describe("the caller's own callbacks", () => {
	/** Starts `start` with callbacks that record their names, and ends it with `receipt`. */
	async function callbacksWhenEnded(start: (typeof SENDS)[number]['start'], receipt?: object) {
		const called: string[] = [];
		const sends = renderSends().result;
		await startAndWait(sends, m =>
			start(m, {
				onSuccess: () => {
					called.push('onSuccess');
				},
				onError: () => called.push('onError'),
				onSettled: () => called.push('onSettled'),
			}),
		);
		await act(async () => {
			confirm(receipt);
		});
		await waitFor(() => expect(called).toContain('onSettled'));
		await settleStarts();
		return called;
	}

	it.each(SENDS)('$name confirmed: onSuccess, then onSettled, each once', async c => {
		expect(await callbacksWhenEnded(c.start, receiptWith(c.event))).toEqual([
			'onSuccess',
			'onSettled',
		]);
	});

	it.each(SENDS)('$name failed, with no onSuccess given: onError is still called', async c => {
		const onError = vi.fn();
		const sends = renderSends().result;
		await startAndWait(sends, m => c.start(m, { onError }));

		await act(async () => {
			confirm();
		});

		await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
	});

	it.each(SENDS)('$name failed: onError, then onSettled, each once', async c => {
		expect(await callbacksWhenEnded(c.start)).toEqual(['onError', 'onSettled']);
	});
});

describe('a confirmed send whose caller is still finishing', () => {
	/** A caller's `onSuccess` that is still working until `finish` or `fail` is called. */
	function unfinishedWork() {
		let finish: () => void = () => undefined;
		let fail: () => void = () => undefined;
		const work = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = () => reject(new Error('the local write failed'));
		});
		return { work, finish: () => finish(), fail: () => fail() };
	}

	/** Starts `c` with `work` as what its caller does on success, and confirms it. */
	async function confirmedWith(c: (typeof SENDS)[number], work: Promise<void>) {
		const sends = renderSends().result;
		await startAndWait(sends, m => c.start(m, { onSuccess: () => work }));
		await act(async () => {
			confirm(receiptWith(c.event));
		});
		await waitFor(() => expect(sends.current.initiatePromptMutation.isPending).toBe(false));
		await waitFor(() => expect(sends.current.regenerateMutation.isPending).toBe(false));
		await waitFor(() => expect(sends.current.branchConversationMutation.isPending).toBe(false));
		await settleStarts();
		return sends;
	}

	it.each(pairs.map(({ first, second }) => [second.name, first.name, first, second] as const))(
		'%s is refused while the caller of %s is still finishing',
		async (_second, _first, first, second) => {
			const { work } = unfinishedWork();
			const sends = await confirmedWith(first, work);

			await act(async () => {
				second.start(sends.current);
			});
			await settleStarts();

			expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
			expect(sends.current.isSending).toBe(true);
		},
	);

	it.each(SENDS)('$name: the next send goes through once the caller has finished', async c => {
		const { work, finish } = unfinishedWork();
		const sends = await confirmedWith(c, work);

		await act(async () => {
			finish();
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		await startAndWait(sends, c.start, 2);
	});

	it.each(SENDS)('$name: the next send goes through when the caller has failed', async c => {
		const { work, fail } = unfinishedWork();
		const sends = await confirmedWith(c, work);

		await act(async () => {
			fail();
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		await startAndWait(sends, c.start, 2);
		expect(console.error).toHaveBeenCalled();
	});
});

describe('a confirmed send whose caller then fails to save it', () => {
	/** Confirms `c`, then fails the caller's work after the transaction was confirmed. */
	async function failedAfterConfirm(c: (typeof SENDS)[number], queryClient = newClient()) {
		const onSaveFailed = vi.fn();
		let fail: () => void = () => undefined;
		const work = new Promise<void>((_resolve, reject) => {
			// The prompt's text in the error, as a library's error could carry it.
			fail = () => reject(new Error(`the local write failed for ${PROMPT_TEXT}`));
		});
		const sends = renderSends(queryClient).result;
		await startAndWait(sends, m => c.start(m, { onSuccess: () => work, onSaveFailed }));
		await act(async () => {
			confirm(receiptWith(c.event));
		});
		await settleStarts();
		await act(async () => {
			fail();
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));
		return { sends, onSaveFailed };
	}

	it.each(SENDS)('$name: the user is told it was sent and paid for and will appear', async c => {
		await failedAfterConfirm(c);

		expect(toast.warning).toHaveBeenCalledTimes(1);
		const [title, options] = vi.mocked(toast.warning).mock.calls[0];
		const description = String((options as { description?: string })?.description);
		expect(title).toMatch(/sent/i);
		expect(description).toMatch(/paid for/);
		expect(description).toMatch(/sync/);
		expect(description).toMatch(/no need to send it again/);
	});

	it.each(SENDS)("$name: the caller's onSaveFailed is called once", async c => {
		const { onSaveFailed } = await failedAfterConfirm(c);

		expect(onSaveFailed).toHaveBeenCalledTimes(1);
	});

	it.each(SENDS)('$name: a sync is asked for with the conversations key', async c => {
		const queryClient = newClient();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

		await failedAfterConfirm(c, queryClient);

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['conversations', SESSION.sessionKey, SESSION.ownerAddress],
		});
	});

	it('is reported to Sentry once per page load, without the text of the prompt', async () => {
		await failedAfterConfirm(SENDS[0]);
		cleanup();
		await failedAfterConfirm(SENDS[1]);

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(vi.mocked(Sentry.captureException).mock.calls)).not.toContain(
			PROMPT_TEXT,
		);
	});

	it.each(SENDS)('$name saved: nothing is shown, cleared or reported', async c => {
		const onSaveFailed = vi.fn();
		const sends = renderSends().result;
		await startAndWait(sends, m => c.start(m, { onSuccess: async () => undefined, onSaveFailed }));
		await act(async () => {
			confirm(receiptWith(c.event));
		});
		await settleStarts();
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		expect(toast.warning).not.toHaveBeenCalled();
		expect(onSaveFailed).not.toHaveBeenCalled();
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});
});

describe('mutateAsync', () => {
	it('is not offered, so nothing can start a send around the refusal', () => {
		const sends = renderSends().result;
		const { initiatePromptMutation, regenerateMutation, branchConversationMutation } =
			sends.current;

		[initiatePromptMutation, regenerateMutation, branchConversationMutation].forEach(m => {
			// @ts-expect-error mutateAsync is left out of the three sending mutations.
			expect(m.mutateAsync).toBeUndefined();
		});
	});
});
