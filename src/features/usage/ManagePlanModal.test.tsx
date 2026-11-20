import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';
import useFeeTokenCheck, { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import useTokenBalance from '@/hooks/useTokenBalance';
import { blocksAction } from '@/lib/feeTokenCheck';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';

import ManagePlanModal from './ManagePlanModal';

// What each test sets: the build's profile, the wallet's chain and the plan mutation.
const state = vi.hoisted(() => ({
	profile: undefined as FeeTokenProfile | undefined,
	chainId: 8453,
	mutate: vi.fn(),
}));

vi.mock('@/config/feeToken', async original => {
	const actual = await original<typeof import('@/config/feeToken')>();
	return {
		...actual,
		get FEE_TOKEN() {
			return state.profile ?? actual.FEE_TOKEN;
		},
	};
});
vi.mock('thirdweb/react', () => ({
	useActiveWallet: () => ({
		getChain: () => ({ id: state.chainId }),
		getAccount: () => ({ address: '0x00000000000000000000000000000000000000aa' }),
	}),
}));
vi.mock('@/config/contracts', () => ({ LOCAL_CHAIN_ID: 31337, TESTNET_CHAIN_ID: 84532 }));
vi.mock('@/hooks/useFaucetRequest', () => ({
	default: () => ({ requestTokens: vi.fn(), faucetAmount: 100 }),
}));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(),
	useIsAwaitingFirstAnswer: vi.fn(),
}));
vi.mock('@/hooks/useTokenBalance', () => ({ default: vi.fn() }));
vi.mock('./PlanValueEstimate', () => ({ default: () => null }));
vi.mock('./usePlanMutations', () => ({
	default: () => ({
		setPlanMutation: { mutate: state.mutate, isPending: false },
		revokeMutation: { mutate: vi.fn(), isPending: false },
	}),
}));

function withBalance(displayValue: string) {
	vi.mocked(useTokenBalance).mockReturnValue({
		data: { displayValue },
		isLoading: false,
	} as unknown as ReturnType<typeof useTokenBalance>);
}

async function renderDialog() {
	render(<ManagePlanModal open onOpenChange={vi.fn()} existingPlan={null} />);
	// Lets the form validate its first values.
	await act(async () => undefined);
}

const submitButton = () => screen.getByRole('button', { name: 'Confirm' });

beforeEach(() => {
	state.profile = FEE_TOKEN_PROFILES.SENSE;
	state.chainId = 8453;
	state.mutate.mockReset();
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict: 'unknown',
		blocks: action => blocksAction('unknown', action),
	});
	vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(false);
	withBalance('500');
});

afterEach(cleanup);

describe('the plan dialog before the fee token check has answered once', () => {
	it('holds the submit: marked switched off with the reason, focusable, and sends nothing', async () => {
		vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(true);
		await renderDialog();

		const button = submitButton();
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect((button as HTMLButtonElement).disabled).toBe(false);
		const describedBy = button.getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(describedBy)?.textContent).toBe(AWAITING_CHECK_REASON);
		button.focus();
		expect(document.activeElement).toBe(button);

		await act(async () => {
			fireEvent.click(button);
		});

		expect(state.mutate).not.toHaveBeenCalled();
	});

	it('sends the plan once the check has answered', async () => {
		await renderDialog();

		const button = submitButton();
		expect(button.getAttribute('aria-disabled')).not.toBe('true');
		await act(async () => {
			fireEvent.click(button);
		});

		expect(state.mutate).toHaveBeenCalledTimes(1);
	});
});

describe('an empty wallet of a token that cannot be got in the app', () => {
	const links = () => screen.queryAllByRole('link');

	it('is pointed to SenseAI on X and the Telegram group', async () => {
		withBalance('0');
		await renderDialog();

		expect(document.body.textContent).toContain(
			`You have no ${FEE_TOKEN_PROFILES.SENSE.symbol} yet.`,
		);
		expect(links().map(link => link.getAttribute('href'))).toEqual([
			'https://x.com/SenseAI_agent',
			'https://t.me/tradable_community',
		]);
	});

	it('is not pointed anywhere when the wallet holds some', async () => {
		withBalance('3');
		await renderDialog();

		expect(links()).toEqual([]);
	});

	it('is not pointed anywhere where the faucet is offered', async () => {
		state.chainId = 84532;
		withBalance('0');
		await renderDialog();

		expect(links()).toEqual([]);
	});

	it('is not pointed anywhere for a token that can be bought', async () => {
		state.profile = FEE_TOKEN_PROFILES.ABLE;
		withBalance('0');
		await renderDialog();

		expect(links()).toEqual([]);
	});
});
