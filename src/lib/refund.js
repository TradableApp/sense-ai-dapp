import { REFUND_TIMEOUT_MS } from '@/lib/constants';

export function isRefundEligible(submittedAt, isAnswered, isCancelled) {
	if (isAnswered || isCancelled) return false;
	return Date.now() > submittedAt + REFUND_TIMEOUT_MS;
}
