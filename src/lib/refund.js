import { REFUND_TIMEOUT_MS } from '@/lib/constants';

export default function isRefundEligible(submittedAt, isAnswered, isCancelled) {
	if (isAnswered || isCancelled) return false;
	return Date.now() > submittedAt + REFUND_TIMEOUT_MS;
}
