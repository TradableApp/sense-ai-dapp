import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import useOracleKeyCheck from '@/hooks/useOracleKeyCheck';
import usePromptsSwitch, { readPromptsSwitchNow } from '@/hooks/usePromptsSwitch';
import type { FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { SWITCH_OPEN } from '@/lib/promptsSwitch';

import usePaymentGate from './usePaymentGate';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn(), readPromptsSwitchNow: vi.fn() }));
vi.mock('@/hooks/useOracleKeyCheck', () => ({ default: vi.fn() }));

function withVerdict(verdict: FeeTokenCheckState) {
	vi.mocked(useFeeTokenCheck).mockReturnValue({ verdict } as ReturnType<typeof useFeeTokenCheck>);
}

beforeEach(() => {
	vi.mocked(useOracleKeyCheck).mockReturnValue('unknown');
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

describe('the oracle key check through the gate', () => {
	it('stops the actions that wrap the session key, and says so', () => {
		withVerdict('ok');
		vi.mocked(useOracleKeyCheck).mockReturnValue('mismatch');
		const { result } = renderHook(() => usePaymentGate());

		expect(result.current.state.oracleKey).toBe('mismatch');
		expect(result.current.blocks('prompt')).toBe(true);
		expect(result.current.blocks('branch')).toBe(true);
		expect(result.current.blocks('metadata')).toBe(true);
		expect(result.current.blocks('plan')).toBe(false);
	});

	it('is read at a later moment as the latest verdict rendered', () => {
		withVerdict('ok');
		vi.mocked(useOracleKeyCheck).mockReturnValue('match');
		const { result, rerender } = renderHook(() => usePaymentGate());
		const { blocksNow, stateNow } = result.current;
		expect(blocksNow('prompt')).toBe(false);

		vi.mocked(useOracleKeyCheck).mockReturnValue('no-key');
		rerender();

		expect(blocksNow('prompt')).toBe(true);
		expect(stateNow().oracleKey).toBe('no-key');
	});
});
