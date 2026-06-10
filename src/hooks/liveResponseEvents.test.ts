import { describe, expect, it } from 'vitest';

import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';

import { AGENT_EVENT_NAMES, ESCROW_EVENT_NAMES, deriveEvents } from './liveResponseEvents';

type Abi = Parameters<typeof deriveEvents>[0];

describe('deriveEvents', () => {
	it('derives a watcher for every agent event present in the ABI', () => {
		// Repro for CU-86d39wcfn: with the bare-signature bug, prepareEvent throws on
		// the first event and the whole list aborts → 0 watchers → AnswerMessageAdded
		// is never detected. The fix prepends "event " so all are prepared.
		const events = deriveEvents(EVMAIAgentABI.abi as unknown as Abi, AGENT_EVENT_NAMES);
		expect(events).toHaveLength(AGENT_EVENT_NAMES.length);
	});

	it('derives a watcher for every escrow event present in the ABI', () => {
		const events = deriveEvents(EVMAIAgentEscrowABI.abi as unknown as Abi, ESCROW_EVENT_NAMES);
		expect(events).toHaveLength(ESCROW_EVENT_NAMES.length);
	});

	it('skips event names not present in the ABI without throwing', () => {
		const events = deriveEvents(EVMAIAgentABI.abi as unknown as Abi, [
			'PromptSubmitted',
			'NotARealEvent',
		]);
		expect(events).toHaveLength(1);
	});

	it('one unpreparable/missing event does not drop the others (resilient)', () => {
		const events = deriveEvents(EVMAIAgentABI.abi as unknown as Abi, [
			'NotReal1',
			'AnswerMessageAdded',
			'NotReal2',
		]);
		expect(events).toHaveLength(1);
	});
});
