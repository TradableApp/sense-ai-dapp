import { REFUND_TIMEOUT_MS } from '@/lib/constants';

export default function isRefundEligible(
	submittedAt: number,
	isAnswered: boolean,
	isCancelled: boolean,
): boolean {
	if (isAnswered || isCancelled) return false;
	return Date.now() > submittedAt + REFUND_TIMEOUT_MS;
}
