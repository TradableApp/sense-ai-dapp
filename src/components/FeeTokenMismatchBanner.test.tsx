import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FeeTokenMismatchBanner from '@/components/FeeTokenMismatchBanner';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

const banner = () => screen.queryByRole('alert');

describe('FeeTokenMismatchBanner', () => {
	afterEach(cleanup);

	it('renders nothing when the check passed', () => {
		checkReturns('ok');
		render(<FeeTokenMismatchBanner />);
		expect(banner()).toBeNull();
	});

	it('renders nothing while the check has no answer: an unreachable node must not stop payments', () => {
		checkReturns('unknown');
		render(<FeeTokenMismatchBanner />);
		expect(banner()).toBeNull();
	});

	it.each([
		'escrow-uses-other-token',
		'symbol-mismatch',
		'escrow-not-exempt',
		'treasury-not-exempt',
		'escrow-serves-other-agent',
		'contract-not-found',
		'token-paused',
	] as const)('shows the title and the explanation for %s', verdict => {
		checkReturns(verdict);
		render(<FeeTokenMismatchBanner />);
		const copy = feeTokenBlockCopy(verdict, 'PTS');
		expect(banner()?.textContent).toContain(copy?.title);
		expect(banner()?.textContent).toContain(copy?.description);
	});

	it('offers nothing to click, so it cannot be dismissed', () => {
		checkReturns('escrow-not-exempt');
		render(<FeeTokenMismatchBanner />);
		expect(banner()).not.toBeNull();
		expect(
			banner()?.querySelector('button, a, [role="button"], [aria-label], [tabindex]'),
		).toBeNull();
	});
});
