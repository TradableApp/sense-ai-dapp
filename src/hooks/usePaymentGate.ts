import { useCallback, useEffect, useMemo, useRef } from 'react';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import useOracleKeyCheck from '@/hooks/useOracleKeyCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import type { PaidAction } from '@/lib/feeTokenCheck';
import { gateBlocks, type PaymentGateState } from '@/lib/paymentGate';

export interface PaymentGate {
	state: PaymentGateState;
	/** Whether a paying action is refused: see `gateBlocks`. */
	blocks: (_action: PaidAction) => boolean;
	/**
	 * The gate's state at this moment, for an action that runs on after a wait: the switch is
	 * read from its store and the fee token and oracle key verdicts are the latest ones
	 * rendered. Stable.
	 */
	stateNow: () => PaymentGateState;
	/** Whether a paying action is refused at this moment. Stable. */
	blocksNow: (_action: PaidAction) => boolean;
}

/**
 * Whether a paying action may go ahead, from the fee token check, the remote prompts switch
 * and the oracle key check together. The only reader of any of them (the `payment-gate`
 * guard): every paying mutation, every control for one and the banner ask this.
 */
export default function usePaymentGate(): PaymentGate {
	const { verdict } = useFeeTokenCheck();
	const prompts = usePromptsSwitch();
	const oracleKey = useOracleKeyCheck();
	const latestVerdict = useRef(verdict);
	const latestOracleKey = useRef(oracleKey);
	useEffect(() => {
		latestVerdict.current = verdict;
		latestOracleKey.current = oracleKey;
	}, [verdict, oracleKey]);

	const stateNow = useCallback(
		(): PaymentGateState => ({
			feeToken: latestVerdict.current,
			prompts: readPromptsSwitchNow(),
			oracleKey: latestOracleKey.current,
		}),
		[],
	);
	const blocksNow = useCallback((action: PaidAction) => gateBlocks(stateNow(), action), [stateNow]);

	return useMemo(() => {
		const state: PaymentGateState = { feeToken: verdict, prompts, oracleKey };
		return { state, blocks: action => gateBlocks(state, action), stateNow, blocksNow };
	}, [verdict, prompts, oracleKey, stateNow, blocksNow]);
}
