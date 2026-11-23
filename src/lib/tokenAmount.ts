import { formatUnits } from 'viem';

/**
 * A raw token amount (the integer the chain moved) as the decimal string a user is shown.
 *
 * Exact: the integer is divided by 10^decimals as a string, never through Number, so no amount is
 * rounded and none above 2^53 loses digits. Trailing zeros are trimmed, but at least one decimal
 * place is kept, so a whole amount reads "1.0". The sign is kept ("-0.25").
 */
export default function formatTokenAmount(amount: bigint, decimals: number): string {
	const exact = formatUnits(amount, decimals);
	return exact.includes('.') ? exact : `${exact}.0`;
}
