import { useMemo } from 'react';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import type { PaidAction } from '@/lib/feeTokenCheck';
import { gateBlocks, type PaymentGateState } from '@/lib/paymentGate';

export interface PaymentGate {
	state: PaymentGateState;
	/** Whether a paying action is refused: see `gateBlocks`. */
	blocks: (_action: PaidAction) => boolean;
}

/**
 * Whether a paying action may go ahead, from the fee token check and the remote prompts
 * switch together. The only reader of either (the `payment-gate` guard): every paying
 * mutation, every control for one and the banner ask this.
 */
export default function usePaymentGate(): PaymentGate {
	const { verdict } = useFeeTokenCheck();
	const prompts = usePromptsSwitch();
	return useMemo(() => {
		const state: PaymentGateState = { feeToken: verdict, prompts };
		return { state, blocks: action => gateBlocks(state, action) };
	}, [verdict, prompts]);
}
