import { useCallback, useEffect, useMemo, useRef } from 'react';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import type { PaidAction } from '@/lib/feeTokenCheck';
import { gateBlocks, type PaymentGateState } from '@/lib/paymentGate';

export interface PaymentGate {
	state: PaymentGateState;
	/** Whether a paying action is refused: see `gateBlocks`. */
	blocks: (_action: PaidAction) => boolean;
	/**
	 * The gate's state at this moment, for an action that runs on after a wait: the switch is
	 * read from its store and the fee token verdict is the latest one rendered. Stable.
	 */
	stateNow: () => PaymentGateState;
	/** Whether a paying action is refused at this moment. Stable. */
	blocksNow: (_action: PaidAction) => boolean;
}

/**
 * Whether a paying action may go ahead, from the fee token check and the remote prompts
 * switch together. The only reader of either (the `payment-gate` guard): every paying
 * mutation, every control for one and the banner ask this.
 */
export default function usePaymentGate(): PaymentGate {
	const { verdict } = useFeeTokenCheck();
	const prompts = usePromptsSwitch();
	const latestVerdict = useRef(verdict);
	useEffect(() => {
		latestVerdict.current = verdict;
	}, [verdict]);

	const stateNow = useCallback(
		(): PaymentGateState => ({ feeToken: latestVerdict.current, prompts: readPromptsSwitchNow() }),
		[],
	);
	const blocksNow = useCallback((action: PaidAction) => gateBlocks(stateNow(), action), [stateNow]);

	return useMemo(() => {
		const state: PaymentGateState = { feeToken: verdict, prompts };
		return { state, blocks: action => gateBlocks(state, action), stateNow, blocksNow };
	}, [verdict, prompts, stateNow, blocksNow]);
}
