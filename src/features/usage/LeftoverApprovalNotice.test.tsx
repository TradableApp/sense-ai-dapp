import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { prepareContractCall, readContract } from 'thirdweb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';

import LeftoverApprovalNotice from './LeftoverApprovalNotice';

/**
 * An approval left on the fee token for the escrow with no plan standing: after a revoke
 * whose second step did not finish, on another device, after a reload, or for a wallet that
 * revoked before revoking removed the approval. The notice is read from the chain, so it
 * survives all of these, and it removes the approval through the plan mutations' removal.
 */

const sendAndConfirm = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => ({ current: undefined as unknown }));
// What the chain answers; an Error is thrown as the read's failure.
const onChain = vi.hoisted(() => ({ allowance: 0n as unknown, limit: [0n, 0n, 0n] as unknown }));

const OWNER = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000c1';
const ESCROW = '0x00000000000000000000000000000000000000e5';

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('thirdweb', () => ({
	getContract: vi.fn((options: { address: string }) => ({ address: options.address })),
	prepareContractCall: vi.fn(
		(options: { contract: unknown; method: string; params?: unknown[] }) => options,
	),
	readContract: vi.fn(),
}));
vi.mock('thirdweb/react', () => {
	const account = { address: '0x00000000000000000000000000000000000000aa' };
	const wallet = { getChain: () => ({ id: 31337 }), getAccount: () => account };
	return {
		useActiveWallet: () => wallet,
		useSendAndConfirmTransaction: () => ({ mutateAsync: sendAndConfirm }),
	};
});
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	CONTRACTS: {
		31337: {
			token: { address: '0x00000000000000000000000000000000000000c1', abi: [] },
			agent: { address: '0x00000000000000000000000000000000000000a9', abi: [] },
			escrow: { address: '0x00000000000000000000000000000000000000e5', abi: [] },
		},
	},
}));
vi.mock('@/config/feeToken', async original => {
	const actual = await original<typeof import('@/config/feeToken')>();
	return {
		...actual,
		get FEE_TOKEN() {
			return profile.current ?? actual.FEE_TOKEN;
		},
	};
});
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(() => ({ verdict: 'ok', blocks: () => false })),
	useIsAwaitingFirstAnswer: vi.fn(() => false),
}));
vi.mock('@/hooks/usePromptsSwitch', () => ({
	default: vi.fn(() => ({ status: 'open' })),
	readPromptsSwitchNow: vi.fn(() => ({ status: 'open' })),
}));
vi.mock('@/lib/utils', async original => ({
	...(await original<typeof import('@/lib/utils')>()),
	wait: vi.fn(async () => undefined),
}));

function renderNotice() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return render(<LeftoverApprovalNotice />, { wrapper });
}

/** Lets the chain reads answer and the notice render what they say. */
async function settle() {
	await act(async () => undefined);
	await waitFor(() => expect(readContract).toHaveBeenCalledTimes(2));
	await act(async () => undefined);
}

const removeButton = () => screen.queryByRole('button', { name: 'Remove approval' });

const calls = () => vi.mocked(prepareContractCall).mock.calls.map(([call]) => call);

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	profile.current = undefined;
	onChain.allowance = 10n;
	onChain.limit = [0n, 0n, 0n];
	sendAndConfirm.mockResolvedValue({ status: 'success' });
	vi.mocked(readContract).mockImplementation((async ({ method }: { method: unknown }) => {
		const answer = String(method).includes('spendingLimits') ? onChain.limit : onChain.allowance;
		if (answer instanceof Error) throw answer;
		return answer;
	}) as never);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('an approval left with no plan', () => {
	it('is told of, with a control to remove it that is described by the notice', async () => {
		renderNotice();
		await settle();

		const button = removeButton();
		expect(button).not.toBeNull();
		const describedBy = button?.getAttribute('aria-describedby') ?? '';
		const description = document.getElementById(describedBy)?.textContent ?? '';
		expect(description).toMatch(/approval/i);
		expect(description).toMatch(/no plan is active/i);
	});

	it('reads the approval and the limit of this account for the escrow', async () => {
		renderNotice();
		await settle();

		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({ contract: { address: TOKEN }, params: [OWNER, ESCROW] }),
		);
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({ contract: { address: ESCROW }, params: [OWNER] }),
		);
	});

	it('is told of for an approval of one wei', async () => {
		onChain.allowance = 1n;
		renderNotice();
		await settle();

		expect(removeButton()).not.toBeNull();
	});

	it('is removed with one approval of zero on the token, after the limit is read again', async () => {
		renderNotice();
		await settle();
		vi.mocked(readContract).mockClear();

		await act(async () => {
			fireEvent.click(removeButton() as HTMLElement);
		});
		await waitFor(() => expect(sendAndConfirm).toHaveBeenCalledTimes(1));

		expect(calls()).toEqual([
			expect.objectContaining({
				contract: { address: TOKEN },
				method: 'approve',
				params: [ESCROW, 0n],
			}),
		]);
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({
				contract: { address: ESCROW },
				method: expect.stringContaining('spendingLimits'),
			}),
		);
	});

	it('goes once the approval is gone', async () => {
		sendAndConfirm.mockImplementation(async () => {
			onChain.allowance = 0n;
			return { status: 'success' };
		});
		renderNotice();
		await settle();

		await act(async () => {
			fireEvent.click(removeButton() as HTMLElement);
		});

		await waitFor(() => expect(removeButton()).toBeNull());
	});

	it('is switched off while the removal is under way', async () => {
		sendAndConfirm.mockImplementation(
			() =>
				new Promise(() => {
					// The wallet has not answered yet.
				}),
		);
		renderNotice();
		await settle();

		await act(async () => {
			fireEvent.click(removeButton() as HTMLElement);
		});
		await waitFor(() => expect(sendAndConfirm).toHaveBeenCalledTimes(1));

		expect((removeButton() as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('no notice', () => {
	it('while a plan is active, whatever is approved', async () => {
		onChain.limit = [100n, 0n, 2_000_000_000n];
		renderNotice();
		await settle();

		expect(removeButton()).toBeNull();
	});

	it('when no approval is left', async () => {
		onChain.allowance = 0n;
		renderNotice();
		await settle();

		expect(removeButton()).toBeNull();
	});

	it.each([
		[
			'the approval cannot be read',
			() => {
				onChain.allowance = new Error('HTTP request failed');
			},
		],
		[
			'the approval read gives no number',
			() => {
				onChain.allowance = '0x';
			},
		],
		[
			'the limit cannot be read',
			() => {
				onChain.limit = new Error('HTTP request failed');
			},
		],
	])('when %s', async (_, arrange) => {
		arrange();
		renderNotice();
		await settle();

		expect(removeButton()).toBeNull();
	});
});

describe.each(Object.values(FEE_TOKEN_PROFILES))(
	'the notice under the $symbol profile',
	(feeToken: FeeTokenProfile) => {
		beforeEach(() => {
			profile.current = feeToken;
		});

		it('names the token of the build, and shows no value in dollars', async () => {
			const { container } = renderNotice();
			await settle();

			expect(container.textContent).toContain(feeToken.symbol);
			expect(container.textContent).not.toContain('$');
		});
	},
);
