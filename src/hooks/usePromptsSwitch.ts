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
