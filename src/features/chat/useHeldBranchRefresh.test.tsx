import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerState } from './promptParent';
import useHeldBranchRefresh, {
	HELD_BRANCH_REREAD_MS,
	HELD_BRANCH_RESYNC_MS,
} from './useHeldBranchRefresh';

const OWNER = '0xowner';
const SESSION_KEY = {} as CryptoKey;

function setup(initialKind: ComposerState['kind'], conversationId = '7') {
	const invalidateQueries = vi.fn();
	const queryClient = { invalidateQueries } as never;
	const hook = renderHook(
		({ kind, id }: { kind: ComposerState['kind']; id: string }) =>
			useHeldBranchRefresh({
				composerKind: kind,
				activeConversationId: id,
				ownerAddress: OWNER,
				sessionKey: SESSION_KEY,
				queryClient,
			}),
		{ initialProps: { kind: initialKind, id: conversationId } },
	);
	const asked = (first: string) =>
		invalidateQueries.mock.calls.filter(([arg]) => arg.queryKey[0] === first).length;
	return { ...hook, asked };
}

describe('a branch held for its history', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('asks for its messages and for a sync again, each on its own timer', () => {
		const { result, asked } = setup('hold');
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(HELD_BRANCH_RESYNC_MS));

		expect(asked('messages')).toBe(HELD_BRANCH_RESYNC_MS / HELD_BRANCH_REREAD_MS);
		expect(asked('conversations')).toBe(1);
	});

	// Each re-read of the messages passes through "loading" and back to "hold". The sync timer
	// is the longer of the two, so it used to be cleared and started again before it ever fired.
	it('still asks for the sync when every re-read passes through loading', () => {
		const { result, rerender, asked } = setup('hold');

		for (let elapsed = 0; elapsed < HELD_BRANCH_RESYNC_MS * 3; elapsed += HELD_BRANCH_REREAD_MS) {
			act(() => vi.advanceTimersByTime(HELD_BRANCH_REREAD_MS));
			rerender({ kind: 'loading', id: '7' });
			expect(result.current, 'still waiting during the re-read').toBe(true);
			rerender({ kind: 'hold', id: '7' });
		}

		expect(asked('conversations')).toBe(3);
	});

	it('stops asking once the composer is ready', () => {
		const { result, rerender, asked } = setup('hold');

		rerender({ kind: 'ready', id: '7' });
		act(() => vi.advanceTimersByTime(HELD_BRANCH_RESYNC_MS * 2));

		expect(result.current).toBe(false);
		expect(asked('messages')).toBe(0);
		expect(asked('conversations')).toBe(0);
	});

	it('does not carry the wait over to another conversation that is still being read', () => {
		const { result, rerender, asked } = setup('hold');

		rerender({ kind: 'loading', id: '8' });
		act(() => vi.advanceTimersByTime(HELD_BRANCH_RESYNC_MS));

		expect(result.current).toBe(false);
		expect(asked('messages')).toBe(0);
	});

	it('asks with the keys the queries are stored under', () => {
		const invalidateQueries = vi.fn();
		renderHook(() =>
			useHeldBranchRefresh({
				composerKind: 'hold',
				activeConversationId: '7',
				ownerAddress: OWNER,
				sessionKey: SESSION_KEY,
				queryClient: { invalidateQueries } as never,
			}),
		);

		act(() => vi.advanceTimersByTime(HELD_BRANCH_RESYNC_MS));

		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages', '7', OWNER] });
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['conversations', SESSION_KEY, OWNER],
		});
	});
});
