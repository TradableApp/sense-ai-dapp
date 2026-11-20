import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FeeTokenMismatchBanner from '@/components/FeeTokenMismatchBanner';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));

const checkReturns = (verdict: string, isBlocked: boolean) =>
	vi
		.mocked(useFeeTokenCheck)
		.mockReturnValue({ verdict, isBlocked } as ReturnType<typeof useFeeTokenCheck>);

const banner = () => screen.queryByRole('alert');

describe('FeeTokenMismatchBanner', () => {
	afterEach(cleanup);

	it('renders nothing when the check passed', () => {
		checkReturns('ok', false);
		render(<FeeTokenMismatchBanner />);
		expect(banner()).toBeNull();
	});

	it('renders nothing while the check has no answer: an unreachable node must not stop payments', () => {
		checkReturns('unknown', false);
		render(<FeeTokenMismatchBanner />);
		expect(banner()).toBeNull();
	});

	it('says payments are switched off when the escrow uses another token', () => {
		checkReturns('escrow-uses-other-token', true);
		render(<FeeTokenMismatchBanner />);
		expect(banner()?.textContent).toMatch(/payments are switched off/i);
	});

	it('cannot be dismissed', () => {
		checkReturns('escrow-not-exempt', true);
		render(<FeeTokenMismatchBanner />);
		expect(screen.queryByRole('button')).toBeNull();
	});
});
