import { describe, expect, it } from 'vitest';

import { decideUpdatePrompt } from '@/lib/updatePrompt';

describe('decideUpdatePrompt', () => {
	it('shows nothing while no new service worker is waiting', () => {
		expect(decideUpdatePrompt({ needRefresh: false, isBusy: false })).toBe('none');
		expect(decideUpdatePrompt({ needRefresh: false, isBusy: true })).toBe('none');
	});

	it('shows the prompt when a worker is waiting and no wallet flow is in flight', () => {
		expect(decideUpdatePrompt({ needRefresh: true, isBusy: false })).toBe('show');
	});

	it('defers the prompt while a wallet flow is in flight', () => {
		expect(decideUpdatePrompt({ needRefresh: true, isBusy: true })).toBe('defer');
	});

	it('is a pure function of its inputs, so a deferred prompt shows once the flow settles', () => {
		// No hidden state: the same waiting worker goes from deferred to shown purely because
		// isBusy dropped, which is exactly the transition the component relies on.
		const busy = decideUpdatePrompt({ needRefresh: true, isBusy: true });
		const idle = decideUpdatePrompt({ needRefresh: true, isBusy: false });
		expect([busy, idle]).toEqual(['defer', 'show']);
	});
});
