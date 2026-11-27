import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { keccak256, stringToBytes } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN } from '@/config/feeToken';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import useOracleKeyCheck from '@/hooks/useOracleKeyCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { encryptData } from '@/lib/crypto';
import eciesEncrypt from '@/lib/ecies';
import {
	blocksAction,
	feeTokenBlockCopy,
	type FeeTokenCheckState,
	type PaidAction,
} from '@/lib/feeTokenCheck';
import { oracleKeyBlockCopy } from '@/lib/oracleKeyCheck';
import { type PromptsSwitchState, SWITCH_WORDINGS, switchCopy } from '@/lib/promptsSwitch';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

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
vi.mock('@/hooks/useOracleKeyCheck', () => ({ default: vi.fn() }));
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

const sessionKey = {} as CryptoKey;

type Mutations = ReturnType<typeof useChatMutations>;

/** Each thing a user pays for, the check it asks, and how it is started. */
const PAYING_ACTIONS: {
	name: string;
	asks: PaidAction;
	run: (_m: Mutations) => Promise<unknown>;
}[] = [
	{
		name: 'send a prompt',
		asks: 'prompt',
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
		asks: 'prompt',
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
		asks: 'branch',
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
		asks: 'metadata',
		run: m =>
			m.metadataUpdateMutation.mutateAsync({
				conversationId: '1',
				title: 'New title',
				isDeleted: false,
				sessionKey,
			}),
	},
	{
		name: 'delete a conversation',
		asks: 'metadata',
		run: m =>
			m.metadataUpdateMutation.mutateAsync({
				conversationId: '1',
				title: 'Title',
				isDeleted: true,
				sessionKey,
			}),
	},
];

/** Getting money back: never asks the check. */
const MONEY_BACK: { name: string; method: string; run: (_m: Mutations) => Promise<unknown> }[] = [
	{
		name: 'cancel a prompt',
		method: 'cancelPrompt',
		run: m => m.cancelPromptMutation.mutateAsync({ answerMessageId: '3' }),
	},
	{
		name: 'claim a refund',
		method: 'processRefund',
		run: m => m.processRefundMutation.mutateAsync({ answerMessageId: '3' }),
	},
];

function withVerdict(verdict: FeeTokenCheckState) {
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});
}

const switchIs = (state: PromptsSwitchState) => vi.mocked(usePromptsSwitch).mockReturnValue(state);

function renderMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useChatMutations(), { wrapper }).result;
}

/** Starts an action and waits for it to settle, whichever way it ends. */
async function attempt(run: (_m: Mutations) => Promise<unknown>): Promise<void> {
	const result = renderMutations();
	await act(async () => {
		await run(result.current).catch(() => undefined);
	});
}

const nothingWasPrepared = () => {
	expect(encryptData).not.toHaveBeenCalled();
	expect(eciesEncrypt).not.toHaveBeenCalled();
	expect(prepareContractCall).not.toHaveBeenCalled();
	expect(sendAndConfirmTransaction).not.toHaveBeenCalled();
};

beforeEach(() => {
	vi.clearAllMocks();
	switchIs({ status: 'open' });
	vi.mocked(useOracleKeyCheck).mockReturnValue('unknown');
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	// Sent, but the receipt carries no event: the paying mutations then fail after sending,
	// which is enough to know that they sent.
	vi.mocked(sendAndConfirmTransaction).mockResolvedValue({ logs: [] } as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

// The verdicts that let each paying action through. Any verdict not listed here stops it,
// so a verdict added later is a stop until someone decides otherwise.
const LETS_THROUGH: Record<PaidAction, readonly FeeTokenCheckState[]> = {
	prompt: ['ok', 'unknown', 'treasury-not-exempt'],
	// Required by the type, but no case here asks for it: the plan is set through its own hook,
	// whose gate usePlanMutations.test.tsx drives the same way.
	plan: ['ok', 'unknown', 'treasury-not-exempt'],
	branch: ['ok', 'unknown'],
	metadata: ['ok', 'unknown'],
};

const cases = PAYING_ACTIONS.flatMap(action =>
	FEE_TOKEN_STATES.map(verdict => ({ ...action, verdict })),
);
const stopped = cases.filter(c => !LETS_THROUGH[c.asks].includes(c.verdict));
const allowed = cases.filter(c => LETS_THROUGH[c.asks].includes(c.verdict));

describe('a paying action the fee token check has switched off', () => {
	it.each(stopped)(
		'$name under $verdict: nothing is encrypted, prepared or sent',
		async ({ run, verdict }) => {
			withVerdict(verdict);

			await attempt(run);

			nothingWasPrepared();
		},
	);

	it.each(stopped)('$name under $verdict: the user sees the banner words', async c => {
		withVerdict(c.verdict);

		await attempt(c.run);

		const copy = feeTokenBlockCopy(c.verdict, FEE_TOKEN.symbol);
		expect(copy).not.toBeNull();
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(copy?.title, { description: copy?.description });
	});
});

describe('a paying action the check lets through', () => {
	it.each(allowed)('$name under $verdict is encrypted and sent', async ({ run, verdict }) => {
		withVerdict(verdict);

		await attempt(run);

		expect(encryptData).toHaveBeenCalledTimes(1);
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});

	it.each(PAYING_ACTIONS.filter(a => a.asks === 'prompt'))(
		'$name is still sent when only the treasury is not listed',
		async ({ run }) => {
			withVerdict('treasury-not-exempt');

			await attempt(run);

			expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
		},
	);
});

describe('getting money back is never switched off', () => {
	const moneyBackCases = MONEY_BACK.flatMap(action =>
		FEE_TOKEN_STATES.map(verdict => ({ ...action, verdict })),
	);

	it.each(moneyBackCases)('$name is sent under $verdict', async ({ run, method, verdict }) => {
		withVerdict(verdict);

		await attempt(run);

		expect(prepareContractCall).toHaveBeenCalledWith(expect.objectContaining({ method }));
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});
});

describe('a paying action while prompts are closed by the switch', () => {
	const closedCases = PAYING_ACTIONS.flatMap(action =>
		FEE_TOKEN_STATES.map(verdict => ({ ...action, verdict })),
	);

	it.each(closedCases)(
		'$name under $verdict: nothing is encrypted, prepared or sent',
		async ({ run, verdict }) => {
			withVerdict(verdict);
			switchIs({ status: 'closed', wording: 'maintenance' });

			await attempt(run);

			nothingWasPrepared();
		},
	);

	it.each(PAYING_ACTIONS.flatMap(a => SWITCH_WORDINGS.map(wording => ({ ...a, wording }))))(
		'$name closed for $wording: the user sees the switch words',
		async ({ run, wording }) => {
			withVerdict('ok');
			switchIs({ status: 'closed', wording });

			await attempt(run);

			const copy = switchCopy(wording);
			expect(toast.error).toHaveBeenCalledTimes(1);
			expect(toast.error).toHaveBeenCalledWith(copy.title, { description: copy.description });
		},
	);

	it.each(PAYING_ACTIONS)('$name is sent again once the switch reopens', async ({ run }) => {
		withVerdict('ok');
		switchIs({ status: 'open' });

		await attempt(run);

		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});

	it.each(PAYING_ACTIONS)('$name is sent while the switch has not been heard', async ({ run }) => {
		withVerdict('ok');
		switchIs({ status: 'unknown' });

		await attempt(run);

		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});

	it.each(MONEY_BACK)('$name is still sent while prompts are closed', async ({ run, method }) => {
		withVerdict('ok');
		switchIs({ status: 'closed', wording: 'incident' });

		await attempt(run);

		expect(prepareContractCall).toHaveBeenCalledWith(expect.objectContaining({ method }));
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});
});

describe('a cancellation the token refuses', () => {
	const selector = keccak256(stringToBytes('TransferNotAllowed(address,address)')).slice(0, 10);
	const rejections = [
		['by name', 'execution reverted: TransferNotAllowed'],
		['by bare selector', `Encoded error signature "${selector}" not found on ABI.`],
	] as const;
	const refusals = rejections.flatMap(([how, message]) =>
		(['escrow-not-exempt', 'treasury-not-exempt'] as const).map(verdict => ({
			how,
			message,
			verdict,
		})),
	);

	it.each(refusals)(
		'reaches the cancellation wording for $verdict when refused $how',
		async ({ message, verdict }) => {
			withVerdict(verdict);
			vi.mocked(sendAndConfirmTransaction).mockRejectedValue(new Error(message));

			await attempt(MONEY_BACK[0].run);

			const [title, options] = vi.mocked(toast.error).mock.calls.at(-1) ?? [];
			const { description } = options as { description: string };
			expect(title).toBe('Could Not Cancel');
			if (verdict === 'escrow-not-exempt') {
				expect(description).toMatch(/refund would be refused too/i);
			} else {
				expect(description).toMatch(/can claim a refund one hour after/i);
			}
		},
	);
});

describe('a paying action while the oracle key check stops it', () => {
	const keyCases = PAYING_ACTIONS.flatMap(action =>
		(['mismatch', 'no-key'] as const).map(oracleKey => ({ ...action, oracleKey })),
	);

	it.each(keyCases)(
		'$name under $oracleKey: the session key is not wrapped and nothing is sent',
		async ({ run, oracleKey }) => {
			withVerdict('ok');
			vi.mocked(useOracleKeyCheck).mockReturnValue(oracleKey);

			await attempt(run);

			nothingWasPrepared();
		},
	);

	it.each(keyCases)('$name under $oracleKey: the user sees the banner words', async c => {
		withVerdict('ok');
		vi.mocked(useOracleKeyCheck).mockReturnValue(c.oracleKey);

		await attempt(c.run);

		const copy = oracleKeyBlockCopy(c.oracleKey);
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(copy?.title, { description: copy?.description });
	});

	it.each(
		PAYING_ACTIONS.flatMap(action =>
			(['match', 'no-key-localnet', 'unknown'] as const).map(oracleKey => ({
				...action,
				oracleKey,
			})),
		),
	)('$name under $oracleKey is encrypted and sent', async ({ run, oracleKey }) => {
		withVerdict('ok');
		vi.mocked(useOracleKeyCheck).mockReturnValue(oracleKey);

		await attempt(run);

		expect(eciesEncrypt).toHaveBeenCalledTimes(1);
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});

	it.each(
		MONEY_BACK.flatMap(action =>
			(['mismatch', 'no-key'] as const).map(oracleKey => ({ ...action, oracleKey })),
		),
	)('$name is still sent under $oracleKey', async ({ run, method, oracleKey }) => {
		withVerdict('ok');
		vi.mocked(useOracleKeyCheck).mockReturnValue(oracleKey);

		await attempt(run);

		expect(prepareContractCall).toHaveBeenCalledWith(expect.objectContaining({ method }));
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
	});
});
