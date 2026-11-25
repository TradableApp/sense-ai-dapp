import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { prepareContractCall, sendAndConfirmTransaction } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptData } from '@/lib/crypto';
import { resetPromptsSwitchSource } from '@/lib/promptsSwitchSource';
import { resetSwitchStub, serverSays } from '@/test/promptsSwitchStub';

import useChatMutations from './useChatMutations';

/**
 * The whole path from the switch document to a paid send: the real switch source and store,
 * the real gate and the real chat mutations, with only Firestore, the wallet and the chain
 * stood in for. A closure heard by an already-mounted hook stops its next send.
 */
vi.mock(
	'firebase/firestore',
	async () => (await import('@/test/promptsSwitchStub')).firestoreModule,
);
vi.mock('@/config/firebase', async () => (await import('@/test/promptsSwitchStub')).firebaseModule);
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
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
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));
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
// Each paying call first reads the fee it will name as its maximum. A plain function, so a
// reset of the mocks between tests leaves it answering.
vi.mock('@/lib/escrowFee', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/escrowFee')>()),
	readEscrowFee: async () => 1n,
}));

const sessionKey = {} as CryptoKey;

function mountMutations() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useChatMutations(), { wrapper }).result;
}

async function sendPrompt(result: ReturnType<typeof mountMutations>) {
	await act(async () => {
		await result.current.initiatePromptMutation
			.mutateAsync({
				conversationId: '1',
				promptText: 'hello',
				sessionKey,
				parentId: 2,
				parentCID: 'cid-2',
			})
			.catch(() => undefined);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	resetSwitchStub();
	resetPromptsSwitchSource();
	localStorage.clear();
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', '0x04abcd');
	vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(sendAndConfirmTransaction).mockResolvedValue({ logs: [] } as never);
});

afterEach(() => {
	cleanup();
	resetPromptsSwitchSource();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('a mounted chat hook when the switch closes', () => {
	it('sends while open, and the next send after the closure prepares and sends nothing', async () => {
		const result = mountMutations();
		serverSays({ closed: false });

		await sendPrompt(result);
		expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);

		serverSays({ closed: true, reason: 'pair-retired' });
		vi.clearAllMocks();
		await sendPrompt(result);

		expect(encryptData).not.toHaveBeenCalled();
		expect(prepareContractCall).not.toHaveBeenCalled();
		expect(sendAndConfirmTransaction).not.toHaveBeenCalled();
	});
});
