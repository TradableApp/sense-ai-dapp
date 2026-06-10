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
 */
export function deriveEvents(abi: Abi, eventNames: readonly string[]) {
	const events: ReturnType<typeof prepareEvent>[] = [];
	try {
		eventNames.forEach(name => {
			const item = getAbiItem({ abi, name });
			if (item) {
				const signature = formatAbiItem(item as AbiEvent);
				events.push(prepareEvent({ signature: signature as `event ${string}` }));
			}
		});
	} catch (error) {
		console.error('[useLiveResponse] Failed to derive events:', error);
	}
	return events;
}
