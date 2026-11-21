import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import showUnsavedPrompt from './unsavedPrompt';
import { holdUnsavedSend, unsavedSendFor, type UnsavedSend, useUnsavedSends } from './unsavedSends';

const OWNER = '0x00000000000000000000000000000000000000aa';
const IDS = { conversationId: '5', promptMessageId: '11', answerMessageId: '12' };

beforeEach(() => localStorage.clear());

describe('a prompt shown from its receipt', () => {
	// Kept with the hold, so the chat can show it again when its conversation is opened again.
	it('is kept with its hold, in memory', () => {
		const queryClient = new QueryClient();
		const send = unsavedSendFor(
			'prompt',
			{ conversationId: '5', parentId: 4 },
			IDS,
			OWNER,
			Date.now(),
		) as UnsavedSend;
		holdUnsavedSend(queryClient, send);

		showUnsavedPrompt(vi.fn(), {
			activeConversationId: '5',
			parentId: '4',
			content: 'A follow-up',
			ids: IDS,
			at: 1_000,
			queryClient,
			ownerAddress: OWNER,
		});

		const held = renderHook(() => useUnsavedSends(queryClient, OWNER)).result.current;
		expect(held[0].shownPrompt).toEqual([
			expect.objectContaining({ id: '11', content: 'A follow-up', createdAt: 1_000 }),
			expect.objectContaining({ id: '12', content: null, parentId: '11' }),
		]);
	});
});
