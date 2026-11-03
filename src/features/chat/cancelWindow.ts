export interface CancelAffordance {
	/** True once the escrow would accept cancelPrompt (deadline reached, or unknown). */
	isCancellable: boolean;
	/** Whole seconds until the window opens; 0 once it has. */
	secondsLeft: number;
	/** Button text: a countdown while the chain would refuse, plain "Cancel" once it accepts. */
	label: string;
}

/**
 * The composer's cancel affordance follows the escrow, not the other way round.
 * `EVMAIAgentEscrow.cancelPrompt` reverts `PromptNotCancellableYet` until
 * `createdAt + CANCELLATION_TIMEOUT` (3 s) and accepts from then until the answer lands, so the
 * button is disabled with a countdown first and enabled afterwards. `deadline` is the wall-clock
 * instant the window opens (receipt time + 3 s: the receipt arrives after the block that set
 * `createdAt`, so wall-clock + 3 s is never early). `null` means the deadline is unknown (page
 * reloaded while the prompt was pending): let the user try, the contract's own
 * "too soon" error is the fallback for a prompt under 3 s old.
 */
export function cancelWindow(deadline: number | null, now: number): CancelAffordance {
	const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
	const isCancellable = secondsLeft === 0;
	return {
		isCancellable,
		secondsLeft,
		label: isCancellable ? 'Cancel' : `Cancel in ${secondsLeft}s`,
	};
}
