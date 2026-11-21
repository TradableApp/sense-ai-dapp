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

import { useUnsavedSends } from './unsavedSends';
import useOneSendAtATime, { forgetSaveFailureReports, SAVE_GIVE_UP_MS } from './useOneSendAtATime';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
const SESSION = vi.hoisted(() => ({
	sessionKey: {} as CryptoKey,
	ownerAddress: '0x00000000000000000000000000000000000000aa',
}));
// The session the chat has now; a test changes it to see which one a late failure uses.
const currentSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => currentSession.value ?? SESSION,
}));

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
// The prompts switch stays open here; its own tests close it.
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: () => ({ status: 'open' }) }));
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
	onSaveFailed?: (_ids?: unknown) => void;
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

/** Rows of a table, each led by its send's name for the test's title. */
const named = <C extends { name: string }, T>(rows: readonly (readonly [C, T])[]) =>
	rows.map(([c, x]) => [c.name, c, x] as const);

/** A prompt that starts a conversation: the chat sends it with no conversation id. */
const NEW_CONVERSATION_PROMPT: (typeof SENDS)[number] = {
	name: 'starting a conversation',
	event: 'PromptSubmitted',
	start: (m, o) =>
		m.initiatePromptMutation.mutate(
			{ conversationId: 0, promptText: PROMPT_TEXT, sessionKey, parentId: null, parentCID: null },
			o,
		),
};

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
	// Holds are saved per wallet: each test starts with none.
	localStorage.clear();
	vi.clearAllMocks();
	forgetSaveFailureReports();
	currentSession.value = null;
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

	it.each(pairs.map(({ first, second }) => [second.name, first.name, first, second] as const))(
		'%s is refused in a chat opened again while the caller of %s is still finishing',
		async (_second, _first, first, second) => {
			const queryClient = newClient();
			const { work } = unfinishedWork();
			const left = renderSends(queryClient);
			await startAndWait(left.result, m => first.start(m, { onSuccess: () => work }));
			await act(async () => {
				confirm(receiptWith(first.event));
			});
			await settleStarts();
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
	/** Starts and confirms `c`; its caller's work is still running until `fail` is called. */
	async function confirmedThenFailing(
		c: (typeof SENDS)[number],
		{
			queryClient = newClient(),
			sent = 1,
			onSaveFailed = vi.fn(),
		}: { queryClient?: QueryClient; sent?: number; onSaveFailed?: (_ids?: unknown) => void } = {},
	) {
		let fail: () => void = () => undefined;
		const work = new Promise<void>((_resolve, reject) => {
			// The prompt's text in the error, as a library's error could carry it.
			fail = () => reject(new Error(`the local write failed for ${PROMPT_TEXT}`));
		});
		const rendered = renderSends(queryClient);
		const sends = rendered.result;
		await startAndWait(sends, m => c.start(m, { onSuccess: () => work, onSaveFailed }), sent);
		await act(async () => {
			confirm(receiptWith(c.event));
		});
		await settleStarts();
		return { rendered, sends, onSaveFailed, fail: () => fail() };
	}

	/** Confirms `c`, then fails the caller's work after the transaction was confirmed. */
	async function failedAfterConfirm(
		c: (typeof SENDS)[number],
		options: Parameters<typeof confirmedThenFailing>[1] = {},
	) {
		const confirmed = await confirmedThenFailing(c, options);
		await act(async () => {
			confirmed.fail();
		});
		await waitFor(() => expect(confirmed.sends.current.isSending).toBe(false));
		return confirmed;
	}

	// An edit or a prompt in a conversation is indexed when it is sent; a new conversation, a
	// regenerate and a branch show nothing until the answer comes. On a device whose store is
	// what failed it may never show, so nothing promises it will.
	it.each(
		named([
			[SENDS[0], /will appear once your history syncs/],
			[NEW_CONVERSATION_PROMPT, /will appear when the answer arrives/],
			[SENDS[1], /will appear when the answer arrives/],
			[SENDS[2], /will appear in your history once it is listed/],
		] as const),
	)(
		'%s: the user is told it was sent and paid for, and when it appears',
		async (_name, c, when) => {
			await failedAfterConfirm(c);

			expect(toast.warning).toHaveBeenCalledTimes(1);
			const [title, options] = vi.mocked(toast.warning).mock.calls[0];
			const description = String((options as { description?: string })?.description);
			expect(title).toMatch(/sent/i);
			expect(description).toMatch(/paid for/);
			expect(description).toMatch(when);
			expect(description).toMatch(/unless saving on this device keeps failing/);
			expect(description).toMatch(/no need to send it again/);
		},
	);

	it.each(
		named([
			[SENDS[0], { kind: 'prompt', composerKeys: ['1'] }],
			[NEW_CONVERSATION_PROMPT, { kind: 'prompt', composerKeys: ['new', '7'] }],
			[SENDS[1], { kind: 'regenerate', composerKeys: ['1'] }],
			[SENDS[2], { kind: 'branch', composerKeys: [] }],
		] as const),
	)('%s: the send is held for every chat on the same client', async (_name, c, expected) => {
		const queryClient = newClient();
		await failedAfterConfirm(c, { queryClient });

		const held = renderHook(() => useUnsavedSends(queryClient, SESSION.ownerAddress)).result;
		expect(held.current).toEqual([expect.objectContaining(expected)]);
	});

	// The hold lasts an hour from the confirmation: any other time would end it at once, or
	// keep it past the moment a refund can be claimed.
	it.each(SENDS)('$name: the hold carries the time the send was confirmed', async c => {
		const queryClient = newClient();
		const before = Date.now();
		await failedAfterConfirm(c, { queryClient });
		const after = Date.now();

		const held = renderHook(() => useUnsavedSends(queryClient, SESSION.ownerAddress)).result;
		const [send] = held.current;
		expect(send.confirmedAt).toBeGreaterThanOrEqual(before);
		expect(send.confirmedAt).toBeLessThanOrEqual(after);
	});

	it.each(SENDS)('$name saved: nothing is held', async c => {
		const queryClient = newClient();
		const sends = renderSends(queryClient).result;
		await startAndWait(sends, m => c.start(m, { onSuccess: async () => undefined }));
		await act(async () => {
			confirm(receiptWith(c.event));
		});
		await waitFor(() => expect(sends.current.isSending).toBe(false));

		const held = renderHook(() => useUnsavedSends(queryClient, SESSION.ownerAddress)).result;
		expect(held.current).toEqual([]);
	});

	it.each(
		named([
			[SENDS[0], { conversationId: '7', promptMessageId: '7', answerMessageId: '7' }],
			[SENDS[1], { newAnswerMessageId: '7' }],
			[SENDS[2], { newConversationId: '7' }],
		] as const),
	)("%s: the caller's onSaveFailed is given the receipt's ids", async (_name, c, ids) => {
		const { onSaveFailed } = await failedAfterConfirm(c);

		expect(vi.mocked(onSaveFailed).mock.calls[0][0]).toEqual(ids);
	});

	it.each(
		named([
			[SENDS[0], '1'],
			[NEW_CONVERSATION_PROMPT, '7'],
			[SENDS[1], '1'],
			[SENDS[2], '7'],
		] as const),
	)('%s: the messages of the conversation it shows in are read again', async (_name, c, id) => {
		const queryClient = newClient();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

		await failedAfterConfirm(c, { queryClient });

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['messages', id, SESSION.ownerAddress],
		});
	});

	// The warning is a step like the others: one that throws must not cost the user the
	// cleared input, the sync, the report or the lock.
	it.each(SENDS)(
		'$name: a warning that throws still clears, syncs, reports and releases',
		async c => {
			vi.mocked(toast.warning).mockImplementation(() => {
				throw new Error('the toaster is gone');
			});
			const queryClient = newClient();
			const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

			const { sends, onSaveFailed } = await failedAfterConfirm(c, { queryClient });

			expect(onSaveFailed).toHaveBeenCalledTimes(1);
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ['conversations', SESSION.sessionKey, SESSION.ownerAddress],
			});
			expect(Sentry.captureException).toHaveBeenCalledTimes(1);
			expect(sends.current.isSending).toBe(false);
		},
	);

	it.each(SENDS)("$name: the caller's onSaveFailed is called once", async c => {
		const { onSaveFailed } = await failedAfterConfirm(c);

		expect(onSaveFailed).toHaveBeenCalledTimes(1);
	});

	it.each(SENDS)('$name: a sync is asked for with the conversations key', async c => {
		const queryClient = newClient();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

		await failedAfterConfirm(c, { queryClient });

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['conversations', SESSION.sessionKey, SESSION.ownerAddress],
		});
	});

	it('is reported to Sentry once per page load, without the text of the prompt', async () => {
		await failedAfterConfirm(SENDS[0]);
		cleanup();
		await failedAfterConfirm(SENDS[1], { sent: 2 });

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(vi.mocked(Sentry.captureException).mock.calls)).not.toContain(
			PROMPT_TEXT,
		);
	});

	// Sentry's console breadcrumb joins console.error's arguments into its message, and goes
	// with the report and every later event: the error's message must not be among them.
	it.each(SENDS)('$name: the console is given the error name only', async c => {
		await failedAfterConfirm(c);

		const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
		expect(console.error).toHaveBeenCalled();
		expect(logged).toContain('Error');
		expect(logged).not.toContain(PROMPT_TEXT);
		expect(logged).not.toContain('local write failed');
	});

	it.each(SENDS)(
		'$name: an onSaveFailed that throws still warns and releases the lock',
		async c => {
			const onSaveFailed = vi.fn(() => {
				throw new Error('the composer is gone');
			});
			const { sends } = await failedAfterConfirm(c, { onSaveFailed });

			expect(toast.warning).toHaveBeenCalledTimes(1);
			expect(sends.current.isSending).toBe(false);
			await startAndWait(sends, c.start, 2);
		},
	);

	// The log is a step like the others: a console that throws must not cost the user the
	// warning, the cleared input or the sync.
	it.each(SENDS)('$name: a console that throws still warns, clears and releases', async c => {
		vi.mocked(console.error).mockImplementation(() => {
			throw new Error('the console is gone');
		});
		const { sends, onSaveFailed } = await failedAfterConfirm(c);

		expect(toast.warning).toHaveBeenCalledTimes(1);
		expect(onSaveFailed).toHaveBeenCalledTimes(1);
		expect(sends.current.isSending).toBe(false);
	});

	// Long words, and on regenerate and branch the only thing between the user and a reflex
	// second press: it stays until closed, and a second failure replaces it.
	it('stays up until closed, under one id, and a second failure shows it again', async () => {
		await failedAfterConfirm(SENDS[0]);
		cleanup();
		await failedAfterConfirm(SENDS[1], { sent: 2 });

		expect(toast.warning).toHaveBeenCalledTimes(2);
		const [first, second] = vi.mocked(toast.warning).mock.calls.map(([, options]) => options);
		expect(first).toMatchObject({ duration: Infinity, id: expect.any(String) });
		expect(second).toMatchObject({ duration: Infinity, id: (first as { id: string }).id });
	});

	it('asks for the sync of the session the send was made in', async () => {
		const queryClient = newClient();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
		const { rendered, fail } = await confirmedThenFailing(SENDS[0], { queryClient });

		currentSession.value = { sessionKey: {} as CryptoKey, ownerAddress: `0x${'b'.repeat(40)}` };
		rendered.rerender();
		await act(async () => {
			fail();
		});
		await waitFor(() => expect(invalidate).toHaveBeenCalled());

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['conversations', SESSION.sessionKey, SESSION.ownerAddress],
		});
	});

	// The session is read as the send starts: a session that changes while the wallet is open
	// must not decide which wallet's history is asked for.
	it('asks for the sync of the session the send was started in, not the one confirmed in', async () => {
		const queryClient = newClient();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
		let fail: () => void = () => undefined;
		const work = new Promise<void>((_resolve, reject) => {
			fail = () => reject(new Error('the local write failed'));
		});
		const rendered = renderSends(queryClient);
		await startAndWait(rendered.result, m => SENDS[0].start(m, { onSuccess: () => work }));

		currentSession.value = { sessionKey: {} as CryptoKey, ownerAddress: `0x${'b'.repeat(40)}` };
		rendered.rerender();
		await act(async () => {
			confirm(receiptWith(SENDS[0].event));
		});
		await settleStarts();
		await act(async () => {
			fail();
		});
		await waitFor(() => expect(invalidate).toHaveBeenCalled());

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['conversations', SESSION.sessionKey, SESSION.ownerAddress],
		});
		expect(invalidate).not.toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: expect.arrayContaining([`0x${'b'.repeat(40)}`]) }),
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

describe('a confirmed send whose caller never finishes saving it', () => {
	// A save that never settles (the store blocked by another tab) would otherwise refuse
	// every paid send for the rest of the page load, with nothing said.
	it.each(SENDS)(
		'$name: after a named time the lock lets go and the failure is handled',
		async c => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			try {
				const onSaveFailed = vi.fn();
				const sends = renderSends().result;
				const never = new Promise<void>(() => {
					// Never settles.
				});
				await startAndWait(sends, m => c.start(m, { onSuccess: () => never, onSaveFailed }));
				await act(async () => {
					confirm(receiptWith(c.event));
				});
				await settleStarts();
				expect(sends.current.isSending).toBe(true);

				await act(async () => {
					vi.advanceTimersByTime(SAVE_GIVE_UP_MS);
				});

				await waitFor(() => expect(sends.current.isSending).toBe(false));
				expect(toast.warning).toHaveBeenCalledTimes(1);
				expect(onSaveFailed).toHaveBeenCalledTimes(1);
				expect(Sentry.captureException).toHaveBeenCalledTimes(1);
			} finally {
				vi.useRealTimers();
			}
		},
	);

	// The prompt is shown with the time it was confirmed, not the time the save was given up
	// on: the refund countdown and the cancel window run from the confirmation.
	it.each(SENDS)('$name: onSaveFailed is given the time the send was confirmed', async c => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const onSaveFailed = vi.fn();
			const sends = renderSends().result;
			const never = new Promise<void>(() => {
				// Never settles.
			});
			await startAndWait(sends, m => c.start(m, { onSuccess: () => never, onSaveFailed }));
			const beforeConfirm = Date.now();
			await act(async () => {
				confirm(receiptWith(c.event));
			});
			await settleStarts();
			const afterConfirm = Date.now();

			await act(async () => {
				vi.advanceTimersByTime(SAVE_GIVE_UP_MS);
			});
			await waitFor(() => expect(onSaveFailed).toHaveBeenCalledTimes(1));

			const confirmedAt = onSaveFailed.mock.calls[0][1] as number;
			expect(confirmedAt).toBeGreaterThanOrEqual(beforeConfirm);
			expect(confirmedAt).toBeLessThanOrEqual(afterConfirm);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not let go before that time', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const sends = renderSends().result;
			const never = new Promise<void>(() => {
				// Never settles.
			});
			await startAndWait(sends, m => SENDS[0].start(m, { onSuccess: () => never }));
			await act(async () => {
				confirm(receiptWith(SENDS[0].event));
			});
			await settleStarts();

			await act(async () => {
				vi.advanceTimersByTime(SAVE_GIVE_UP_MS - 1_000);
			});

			expect(sends.current.isSending).toBe(true);
			expect(toast.warning).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('the time a save is given up on', () => {
	// The tests above wait for the constant, so they would pass whatever it said.
	it('is thirty seconds', () => {
		expect(SAVE_GIVE_UP_MS).toBe(30_000);
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
