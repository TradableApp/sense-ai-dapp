import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN } from '@/config/feeToken';
import useStuckRequests from '@/hooks/useStuckRequests';

import PlanStatusCard from './PlanStatusCard';

vi.mock('@/hooks/useStuckRequests', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useChatMutations', () => ({
	default: () => ({
		processRefundMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
	}),
}));
vi.mock('./ManagePlanModal', () => ({ default: () => null }));

const PLAN = {
	allowance: 10,
	spentAmount: 1,
	expiresAt: null,
	pendingEscrowCount: 1,
	realTokenAllowance: 10,
};

const STUCK = { id: '7', amount: '1', createdAt: Date.now() - 60_000, isRefundable: false };

function stuckState(state: { data?: unknown; isError: boolean }) {
	vi.mocked(useStuckRequests).mockReturnValue(state as never);
}

const notice = () => screen.queryByText(/could not be checked just now/);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// A failed read is not "nothing stuck": the user is told the list could not be checked,
// rather than shown nothing where a payment they can get back would be.
describe('the pending requests on the plan card', () => {
	it('say they could not be checked just now and will be tried again when the read failed', () => {
		stuckState({ data: undefined, isError: true });

		render(<PlanStatusCard plan={PLAN} />);

		const shown = notice();
		expect(shown).not.toBeNull();
		expect(shown?.textContent).toMatch(/tried again/);
		expect(shown?.textContent).not.toContain(FEE_TOKEN.symbol);
		expect(shown?.textContent).not.toMatch(/\$|price/i);
	});

	it('keep the list last read beside that notice', () => {
		stuckState({ data: [STUCK], isError: true });

		render(<PlanStatusCard plan={PLAN} />);

		expect(notice()).not.toBeNull();
		expect(screen.getByText('Request #7')).toBeTruthy();
	});

	it('say nothing of a failure when the read worked', () => {
		stuckState({ data: [STUCK], isError: false });

		render(<PlanStatusCard plan={PLAN} />);

		expect(notice()).toBeNull();
		expect(screen.getByText('Request #7')).toBeTruthy();
	});
});
