import { describe, expect, it } from 'vitest';

import { CANCELLATION_TIMEOUT_MS } from '@/lib/constants';

import { cancelWindow } from './cancelWindow';

// EVMAIAgentEscrow.cancelPrompt reverts PromptNotCancellableYet until createdAt + 3 s and
// accepts from then until the answer lands. The composer's affordance must follow the chain:
// disabled with a countdown while the contract would refuse, enabled once it would accept.
describe('cancelWindow', () => {
	const receipt = 1_000_000;
	const deadline = receipt + CANCELLATION_TIMEOUT_MS;

	it('is not cancellable while the contract still refuses, counting down whole seconds', () => {
		expect(cancelWindow(deadline, receipt)).toEqual({
			isCancellable: false,
			secondsLeft: 3,
			label: 'Cancel in 3s',
		});
		expect(cancelWindow(deadline, receipt + 2_100)).toEqual({
			isCancellable: false,
			secondsLeft: 1,
			label: 'Cancel in 1s',
		});
	});

	it('becomes cancellable the moment the window opens and stays so afterwards', () => {
		expect(cancelWindow(deadline, deadline)).toEqual({
			isCancellable: true,
			secondsLeft: 0,
			label: 'Cancel',
		});
		expect(cancelWindow(deadline, deadline + 60_000).isCancellable).toBe(true);
	});

	it('treats an unknown deadline (page reloaded mid-pending) as cancellable — the contract is the fallback', () => {
		expect(cancelWindow(null, receipt)).toEqual({
			isCancellable: true,
			secondsLeft: 0,
			label: 'Cancel',
		});
	});
});
