import { useSyncExternalStore } from 'react';

import type { PromptsSwitchState } from '@/lib/promptsSwitch';
import { readPromptsSwitch, subscribePromptsSwitch } from '@/lib/promptsSwitchSource';

/**
 * The remote prompts switch for this build's network and agent. Every component that calls
 * this shares one listener, and a change on the server re-renders them all: an open tab
 * closes and reopens with no reload. Read it through `usePaymentGate`, never on its own.
 */
export default function usePromptsSwitch(): PromptsSwitchState {
	return useSyncExternalStore(subscribePromptsSwitch, readPromptsSwitch);
}

/**
 * The switch as it is at this moment, not as it was when a component last rendered: for an
 * action that runs on after a wait, such as the second transaction of a plan. Read it
 * through `usePaymentGate`'s `blocksNow`.
 */
export function readPromptsSwitchNow(): PromptsSwitchState {
	return readPromptsSwitch();
}
