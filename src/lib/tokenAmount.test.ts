import { describe, expect, it } from 'vitest';

import formatTokenAmount from '@/lib/tokenAmount';

const WEI = 10n ** 18n;

describe('formatTokenAmount', () => {
	it('shows a quarter exactly, not rounded to one decimal', () => {
		expect(formatTokenAmount(WEI / 4n, 18)).toBe('0.25');
		expect(formatTokenAmount(-(WEI / 4n), 18)).toBe('-0.25');
	});

	it('shows a small non-zero amount as itself, not as zero', () => {
		expect(formatTokenAmount((WEI * 4n) / 100n, 18)).toBe('0.04');
		expect(formatTokenAmount(-((WEI * 4n) / 100n), 18)).toBe('-0.04');
	});

	it('keeps one decimal place for a whole amount', () => {
		expect(formatTokenAmount(WEI, 18)).toBe('1.0');
		expect(formatTokenAmount(-WEI, 18)).toBe('-1.0');
	});

	it('trims trailing zeros of a one-decimal amount', () => {
		expect(formatTokenAmount((WEI * 3n) / 2n, 18)).toBe('1.5');
		expect(formatTokenAmount(-(WEI / 10n), 18)).toBe('-0.1');
	});

	it('keeps all eighteen decimals when every one is significant', () => {
		expect(formatTokenAmount(WEI + 1n, 18)).toBe('1.000000000000000001');
		expect(formatTokenAmount(123456789012345678n, 18)).toBe('0.123456789012345678');
	});

	it('loses nothing above 2^53 whole tokens', () => {
		const whole = 2n ** 53n + 1n; // 9007199254740993: not representable as a Number
		expect(formatTokenAmount(whole * WEI, 18)).toBe('9007199254740993.0');
		expect(formatTokenAmount(-(whole * WEI + 5n), 18)).toBe('-9007199254740993.000000000000000005');
	});

	it('shows zero as 0.0', () => {
		expect(formatTokenAmount(0n, 18)).toBe('0.0');
	});

	it('reads the decimals it is given, not eighteen', () => {
		expect(formatTokenAmount(250_000n, 6)).toBe('0.25');
		expect(formatTokenAmount(1_000_000n, 6)).toBe('1.0');
		expect(formatTokenAmount(-1n, 6)).toBe('-0.000001');
		// The same raw value read with eighteen decimals would be a vanishing fraction.
		expect(formatTokenAmount(1_500_000n, 6)).toBe('1.5');
	});
});
