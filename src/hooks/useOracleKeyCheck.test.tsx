import type { ReactNode } from 'react';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readContract } from 'thirdweb';
import { useActiveWalletChain } from 'thirdweb/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useOracleKeyCheck, {
	forgetReportedOracleKeyChecks,
	ORACLE_KEY_RECHECK_MS,
} from './useOracleKeyCheck';

const AGENT = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';

function publicKey(secret: number): string {
	const secretKey = new Uint8Array(32);
	secretKey[31] = secret;
	return `0x${bytesToHex(secp256k1.getPublicKey(secretKey, false))}`;
}

const KEY = publicKey(7);
const OTHER_KEY = publicKey(9);

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({
	getContract: vi.fn(({ address }: { address: string }) => ({ address })),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => ({ useActiveWalletChain: vi.fn() }));
vi.mock('@/config/contracts', async importOriginal => {
	const actual = await importOriginal<typeof import('@/config/contracts')>();
	const agent = {
		address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
		abi: [{ type: 'function', name: 'oracleEncryptionKey' }],
	};
	return {
		...actual,
		CONTRACTS: {
			84532: { agent },
			31337: { agent },
			// A chain the build has no agent for.
			1: { agent: { address: undefined, abi: [] } },
		},
	};
});

type Call = { contract: { address: string }; method: { name: string } };

const onChain = (id: number) =>
	vi
		.mocked(useActiveWalletChain)
		.mockReturnValue({ id } as ReturnType<typeof useActiveWalletChain>);

function chainPublishes(answer: unknown) {
	vi.mocked(readContract).mockImplementation((async (call: Call) => {
		expect(call.contract.address).toBe(AGENT);
		expect(call.method.name).toBe('oracleEncryptionKey');
		if (answer instanceof Error) throw answer;
		return answer;
	}) as unknown as typeof readContract);
}

function harness() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return { queryClient, ...renderHook(() => useOracleKeyCheck(), { wrapper }) };
}

/** Every string that reached Sentry, so a test can show no key is among them. */
const sentToSentry = () => JSON.stringify(vi.mocked(Sentry.captureException).mock.calls);

beforeEach(() => {
	vi.stubEnv('VITE_ORACLE_PUBLIC_KEY', KEY);
	onChain(84532);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
	forgetReportedOracleKeyChecks();
});

describe('useOracleKeyCheck', () => {
	it('is unknown before the first answer, and match once the chain publishes the same key', async () => {
		chainPublishes(KEY);
		const { result } = harness();
		expect(result.current).toBe('unknown');
		await waitFor(() => expect(result.current).toBe('match'));
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it('is a mismatch for another key, reported once by its name only', async () => {
		chainPublishes(OTHER_KEY);
		const { result, queryClient } = harness();
		await waitFor(() => expect(result.current).toBe('mismatch'));
		await act(async () => {
			await queryClient.refetchQueries({ queryKey: ['oracleKeyCheck'] });
		});

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect((error as Error).name).toBe('OracleKeyCheckVerdict');
		expect(context).toMatchObject({ tags: { check: 'oracle-key', verdict: 'mismatch' } });
		expect(sentToSentry()).not.toContain(KEY.slice(4, 24));
		expect(sentToSentry()).not.toContain(OTHER_KEY.slice(4, 24));
	});

	it('is no-key on testnet when nothing is published', async () => {
		chainPublishes('0x');
		const { result } = harness();
		await waitFor(() => expect(result.current).toBe('no-key'));
		expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
			tags: { check: 'oracle-key', verdict: 'no-key' },
		});
	});

	it('is no-key-localnet on the local chain, and reports nothing', async () => {
		onChain(31337);
		chainPublishes('0x');
		const { result } = harness();
		await waitFor(() => expect(result.current).toBe('no-key-localnet'));
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it('stays unknown when the read fails, and reports the failure once by its kind only', async () => {
		chainPublishes(new Error(`request to https://rpc.example/key-abc failed for ${KEY}`));
		const { result, queryClient } = harness();
		await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
		await act(async () => {
			await queryClient.refetchQueries({ queryKey: ['oracleKeyCheck'] }).catch(() => undefined);
		});

		expect(result.current).toBe('unknown');
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect((error as Error).name).toBe('OracleKeyCheckFailure');
		expect(context).toMatchObject({ tags: { check: 'oracle-key' } });
		expect(sentToSentry()).not.toContain('rpc.example');
		expect(sentToSentry()).not.toContain(KEY.slice(4, 24));
	});

	it('keeps its last answer through a later failed read', async () => {
		chainPublishes(OTHER_KEY);
		const { result, queryClient } = harness();
		await waitFor(() => expect(result.current).toBe('mismatch'));

		chainPublishes(new Error('node down'));
		await act(async () => {
			await queryClient.refetchQueries({ queryKey: ['oracleKeyCheck'] }).catch(() => undefined);
		});

		expect(result.current).toBe('mismatch');
	});

	it('reads nothing without a wallet or without an agent for the chain', async () => {
		chainPublishes(OTHER_KEY);
		vi.mocked(useActiveWalletChain).mockReturnValue(undefined);
		const first = harness();
		onChain(1);
		const second = harness();
		await act(async () => {
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
		});

		expect(readContract).not.toHaveBeenCalled();
		expect(first.result.current).toBe('unknown');
		expect(second.result.current).toBe('unknown');
	});

	it('asks again after the recheck interval, so a key published later is found', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		chainPublishes('0x');
		const { result } = harness();
		await waitFor(() => expect(result.current).toBe('no-key'));

		chainPublishes(KEY);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ORACLE_KEY_RECHECK_MS);
		});

		await waitFor(() => expect(result.current).toBe('match'));
	});
});
