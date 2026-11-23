import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import type { FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { SWITCH_OPEN } from '@/lib/promptsSwitch';

import usePaymentGate from './usePaymentGate';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn(), readPromptsSwitchNow: vi.fn() }));

function withVerdict(verdict: FeeTokenCheckState) {
	vi.mocked(useFeeTokenCheck).mockReturnValue({ verdict } as ReturnType<typeof useFeeTokenCheck>);
}

beforeEach(() => {
	vi.mocked(usePromptsSwitch).mockReturnValue(SWITCH_OPEN);
	vi.mocked(readPromptsSwitchNow).mockReturnValue(SWITCH_OPEN);
});

// A plan's limit is sent after its approval is confirmed: the verdict asked then is the one
// rendered last, not the one there was when the approval was sent.
describe('the gate asked at a later moment', () => {
	it('uses the latest fee token verdict, through the same stable callbacks', () => {
		withVerdict('ok');
		const { result, rerender } = renderHook(() => usePaymentGate());
		const { blocksNow, stateNow } = result.current;
		expect(blocksNow('plan')).toBe(false);

		withVerdict('token-paused');
		rerender();

		expect(result.current.blocksNow).toBe(blocksNow);
		expect(blocksNow('plan')).toBe(true);
		expect(stateNow().feeToken).toBe('token-paused');
	});
});
