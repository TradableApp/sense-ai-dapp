import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FEE_TOKEN_PROFILES } from '@/config/feeToken';

const useTokenPrice = vi.fn();
vi.mock('@/hooks/useTokenPrice', () => ({ default: () => useTokenPrice() }));

import PlanValueEstimate from './PlanValueEstimate';

const { SENSE, ABLE } = FEE_TOKEN_PROFILES;
const BASE = 8453;
const BASE_SEPOLIA = 84532;
const HARDHAT = 31337;

describe('PlanValueEstimate', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it.each([BASE, BASE_SEPOLIA, HARDHAT])(
		'shows nothing, and asks for no price, for a token with no market value (chain %i)',
		chainId => {
			const { container } = render(
				<PlanValueEstimate limit={500} chainId={chainId} profile={SENSE} />,
			);

			expect(container).toBeEmptyDOMElement();
			expect(useTokenPrice).not.toHaveBeenCalled();
		},
	);

	it('shows the live value of the limit for a priced token on mainnet', () => {
		// 1,000 tokens at $0.02 each = $20.00
		useTokenPrice.mockReturnValue({ data: 0.02, isLoading: false, isError: false });

		const { container } = render(<PlanValueEstimate limit={1000} chainId={BASE} profile={ABLE} />);

		expect(container.textContent).toContain('Current Value: ≈ $20.00 USD');
	});

	it('shows an estimate at the planned price on a test chain', () => {
		// 1,000 tokens at the planned $0.015 each = $15.00
		useTokenPrice.mockReturnValue({ data: undefined, isLoading: false, isError: false });

		const { container } = render(
			<PlanValueEstimate limit={1000} chainId={BASE_SEPOLIA} profile={ABLE} />,
		);

		expect(container.textContent).toContain('Est. Value: ≈ $15.00 USD');
	});

	it('says so when the live price cannot be fetched', () => {
		useTokenPrice.mockReturnValue({ data: undefined, isLoading: false, isError: true });

		const { container } = render(<PlanValueEstimate limit={1000} chainId={BASE} profile={ABLE} />);

		expect(container.textContent).toContain('Could not fetch live price.');
	});
});
