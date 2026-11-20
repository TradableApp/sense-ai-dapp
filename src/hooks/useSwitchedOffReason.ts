import { FEE_TOKEN } from '@/config/feeToken';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import type { PaidAction } from '@/lib/feeTokenCheck';
import { type BannerPlace, switchedOffReason } from '@/lib/feeTokenRefusal';

/**
 * Why the controls for `action` are switched off, or null while it is allowed. A control
 * that pays for something disables itself with this as its reason, so a click cannot be
 * made that would only be refused. Cancel and refund have no such control: getting money
 * back is never switched off. A control in a dialog passes `dialog`, and the dialog mounts
 * the banner itself.
 */
export default function useSwitchedOffReason(
	action: PaidAction,
	place: BannerPlace = 'page',
): string | null {
	const feeTokenCheck = useFeeTokenCheck();
	return feeTokenCheck.blocks(action)
		? switchedOffReason(feeTokenCheck.verdict, FEE_TOKEN.symbol, place)
		: null;
}
