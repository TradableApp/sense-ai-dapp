import { prepareEvent } from 'thirdweb';
import type { AbiEvent } from 'viem';
import { getAbiItem } from 'viem';
import { formatAbiItem } from 'viem/utils';

/** Event names watched on EVMAIAgent for real-time live updates. */
export const AGENT_EVENT_NAMES = [
	'PromptSubmitted',
	'AnswerMessageAdded',
	'RegenerationRequested',
	'BranchRequested',
	'ConversationBranched',
	'MetadataUpdateRequested',
	'ConversationMetadataUpdated',
] as const;

/** Event names watched on EVMAIAgentEscrow. */
export const ESCROW_EVENT_NAMES = [
	'PromptCancelled',
	'PaymentRefunded',
	'SpendingLimitSet',
	'SpendingLimitCancelled',
] as const;

type Abi = Parameters<typeof getAbiItem>[0]['abi'];

/**
 * Build thirdweb event watchers for the given event names that exist in `abi`.
 * Names absent from the ABI are skipped; a signature that can't be prepared is
 * skipped (warned) without aborting the rest.
 */
export function deriveEvents(abi: Abi, eventNames: readonly string[]) {
	const events: ReturnType<typeof prepareEvent>[] = [];
	eventNames.forEach(name => {
		const item = getAbiItem({ abi, name });
		if (!item) return; // not in this ABI — skip
		// getAbiItem can return a function/error sharing the name; only events are valid
		// here. Guard before casting so a future same-named non-event isn't formatted as
		// `event function Name(...)` and silently dropped by the catch below.
		if (item.type !== 'event') {
			console.warn(`[useLiveResponse] ABI item "${name}" is not an event (type: ${item.type}).`);
			return;
		}
		try {
			// thirdweb's prepareEvent needs a full `event Name(...)` signature; viem's
			// formatAbiItem returns the bare `Name(...)`, so prepend the keyword.
			// (Without this it throws UnknownSignatureError — the CU-86d39wcfn bug.)
			const signature = `event ${formatAbiItem(item as AbiEvent)}` as `event ${string}`;
			events.push(prepareEvent({ signature }));
		} catch (error) {
			// Per-event try: one unpreparable signature must not drop the others.
			console.warn(`[useLiveResponse] Could not prepare event "${name}":`, error);
		}
	});
	return events;
}
