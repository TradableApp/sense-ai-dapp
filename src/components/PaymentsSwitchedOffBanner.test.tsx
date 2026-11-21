import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentsSwitchedOffBanner from '@/components/PaymentsSwitchedOffBanner';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { type PromptsSwitchState, SWITCH_WORDINGS, switchCopy } from '@/lib/promptsSwitch';
import { DISAGREEING_STATES } from '@/test/feeTokenVerdicts';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

const switchIs = (state: PromptsSwitchState) => vi.mocked(usePromptsSwitch).mockReturnValue(state);

const banners = () => screen.queryAllByRole('alert');
const banner = () => screen.queryByRole('alert');

beforeEach(() => {
	switchIs({ status: 'open' });
});

afterEach(cleanup);

describe('PaymentsSwitchedOffBanner, for the fee token check', () => {
	it('renders nothing when the check passed', () => {
		checkReturns('ok');
		render(<PaymentsSwitchedOffBanner />);
		expect(banner()).toBeNull();
	});

	it('renders nothing while the check has no answer: an unreachable node must not stop payments', () => {
		checkReturns('unknown');
		render(<PaymentsSwitchedOffBanner />);
		expect(banner()).toBeNull();
	});

	it.each(DISAGREEING_STATES)('shows the title and the explanation for %s', verdict => {
		checkReturns(verdict);
		render(<PaymentsSwitchedOffBanner />);
		const copy = feeTokenBlockCopy(verdict, 'PTS');
		expect(banner()?.textContent).toContain(copy?.title);
		expect(banner()?.textContent).toContain(copy?.description);
	});

	it('offers nothing to click, so it cannot be dismissed', () => {
		checkReturns('escrow-not-exempt');
		switchIs({ status: 'closed', wording: 'incident' });
		render(<PaymentsSwitchedOffBanner />);
		expect(banners()).toHaveLength(2);
		banners().forEach(alert =>
			expect(
				alert.querySelector('button, a, [role="button"], [aria-label], [tabindex]'),
			).toBeNull(),
		);
	});
});

describe('PaymentsSwitchedOffBanner, for the prompts switch', () => {
	beforeEach(() => checkReturns('ok'));

	it.each(SWITCH_WORDINGS)('shows the words for %s', wording => {
		switchIs({ status: 'closed', wording });
		render(<PaymentsSwitchedOffBanner />);

		const copy = switchCopy(wording);
		expect(banners()).toHaveLength(1);
		expect(banner()?.textContent).toContain(copy.title);
		expect(banner()?.textContent).toContain(copy.description);
		expect(banner()?.textContent).toMatch(/claiming a refund/);
	});

	it.each([
		['open', { status: 'open' }],
		['unknown', { status: 'unknown' }],
	] as const)('renders nothing while the switch is %s', (_, state) => {
		switchIs(state);
		render(<PaymentsSwitchedOffBanner />);
		expect(banner()).toBeNull();
	});

	it.each(DISAGREEING_STATES)('beside %s shows the switch first, then the check', verdict => {
		checkReturns(verdict);
		switchIs({ status: 'closed', wording: 'maintenance' });
		render(<PaymentsSwitchedOffBanner />);

		const [first, second] = banners();
		expect(first.textContent).toContain(switchCopy('maintenance').title);
		expect(first.textContent).not.toMatch(/still work/);
		expect(second.textContent).toContain(feeTokenBlockCopy(verdict, 'PTS')?.title);
	});
});
