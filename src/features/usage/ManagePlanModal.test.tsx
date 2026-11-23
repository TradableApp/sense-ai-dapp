import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';
import useFeeTokenCheck, { useIsAwaitingFirstAnswer } from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import useTokenBalance from '@/hooks/useTokenBalance';
import { blocksAction } from '@/lib/feeTokenCheck';
import { AWAITING_CHECK_REASON } from '@/lib/feeTokenRefusal';
import { switchCopy } from '@/lib/promptsSwitch';

import ManagePlanModal from './ManagePlanModal';

// What each test sets: the build's profile, the wallet's chain and the plan mutation.
const state = vi.hoisted(() => ({
	profile: undefined as FeeTokenProfile | undefined,
	chainId: 8453,
	mutate: vi.fn(),
	askAgain: vi.fn(),
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
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: vi.fn(),
	useIsAwaitingFirstAnswer: vi.fn(),
	useAskFeeTokenAgain: () => state.askAgain,
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
const limitField = () => document.getElementById('limit') as HTMLInputElement;

beforeEach(() => {
	state.profile = FEE_TOKEN_PROFILES.SENSE;
	state.chainId = 8453;
	state.mutate.mockReset();
	state.askAgain.mockReset();
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict: 'unknown',
		blocks: action => blocksAction('unknown', action),
	});
	vi.mocked(useIsAwaitingFirstAnswer).mockReturnValue(false);
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
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
		// The press asks the check again at once, so "try again in a moment" is true.
		expect(state.askAgain).toHaveBeenCalledTimes(1);
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

describe('the plan dialog while prompts are closed by the switch', () => {
	it('disables the submit, shows the switch words, and sends nothing', async () => {
		vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording: 'maintenance' });
		await renderDialog();

		expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole('alert').textContent).toContain(switchCopy('maintenance').title);
		await act(async () => {
			fireEvent.click(submitButton());
		});
		expect(state.mutate).not.toHaveBeenCalled();
	});

	it('enables the submit again once the switch is open', async () => {
		await renderDialog();

		expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole('alert')).toBeNull();
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

	// Dust is not enough for the first offer, and the app still offers no way to get more.
	it('is pointed to the same links with dust, without being told it has none', async () => {
		withBalance('0.5');
		await renderDialog();

		expect(document.body.textContent).toContain(
			`You do not have enough ${FEE_TOKEN_PROFILES.SENSE.symbol}.`,
		);
		expect(document.body.textContent).not.toContain('You have no');
		expect(links()).toHaveLength(2);
	});

	it('is not pointed anywhere when the wallet holds enough for the offer', async () => {
		withBalance('30');
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

describe('a first offer that is the whole balance', () => {
	const label = () => screen.queryByText('your full balance');

	it('is labelled beside the field', async () => {
		withBalance('500');
		await renderDialog();

		expect(limitField().value).toBe('500');
		expect(label()).not.toBeNull();
	});

	it('says "your balance in whole tokens" when the balance has a fraction', async () => {
		withBalance('25.7');
		await renderDialog();

		expect(limitField().value).toBe('25');
		expect(label()).toBeNull();
		expect(screen.queryByText('your balance in whole tokens')).not.toBeNull();
	});

	it('loses the label once another amount is typed', async () => {
		withBalance('500');
		await renderDialog();

		await act(async () => {
			fireEvent.change(limitField(), { target: { value: '20' } });
		});

		expect(label()).toBeNull();
	});

	it('is not labelled for a profile whose first offer is a fixed amount', async () => {
		state.profile = FEE_TOKEN_PROFILES.ABLE;
		withBalance('500');
		await renderDialog();

		expect(label()).toBeNull();
	});
});

// The words the form shows, read from the dialog itself rather than from a schema: a schema
// option the installed validation library no longer reads (it ignores unknown ones) would
// change these to its own defaults while every schema-level test still passed.
describe('the plan form says what is wrong in its own words', () => {
	const daysField = () => document.getElementById('days') as HTMLInputElement;

	async function type(field: HTMLInputElement, value: string) {
		await act(async () => {
			fireEvent.change(field, { target: { value } });
		});
	}

	it.each([
		['an empty limit', limitField, '', 'Limit must be a number.'],
		['a limit of zero', limitField, '0', 'Limit must be greater than zero.'],
		['a negative limit', limitField, '-5', 'Limit must be greater than zero.'],
		['an empty duration', daysField, '', 'Days must be a number.'],
		['a duration of zero days', daysField, '0', 'Duration must be at least one day.'],
	])('for %s', async (_label, field, value, message) => {
		await renderDialog();

		await type(field(), value);

		expect(screen.queryByText(message)).not.toBeNull();
		expect(submitButton().hasAttribute('disabled')).toBe(true);
	});

	it('shows no message for a valid limit and duration', async () => {
		await renderDialog();

		await type(limitField(), '20');
		await type(daysField(), '30');

		expect(screen.queryByText(/must be/)).toBeNull();
	});
});
