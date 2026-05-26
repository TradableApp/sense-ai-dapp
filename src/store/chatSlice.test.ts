import { describe, expect, it } from 'vitest';

import chatReducer, {
	type ActiveMessage,
	addReasoningStepById,
	appendLiveMessages,
	type ChatState,
	clearActiveConversation,
	clearUserSession,
	closeRenameModal,
	openRenameModal,
	setActiveConversationId,
	setActiveConversationMessages,
	updateMessageContentById,
} from './chatSlice';

const initialState: ChatState = {
	activeConversationId: null,
	activeConversationMessages: [],
	isRenameModalOpen: false,
	conversationToRename: null,
};

describe('chatSlice', () => {
	it('has correct initial state', () => {
		const state = chatReducer(undefined, { type: '@@INIT' });
		expect(state).toEqual(initialState);
	});

	describe('clearUserSession', () => {
		it('resets entire slice to initial state', () => {
			const dirtyState: ChatState = {
				activeConversationId: 'conv-1',
				activeConversationMessages: [{ id: '1', content: 'hello' }],
				isRenameModalOpen: true,
				conversationToRename: { id: 'conv-1', title: 'Test' },
			};
			const state = chatReducer(dirtyState, clearUserSession());
			expect(state).toEqual(initialState);
		});
	});

	describe('setActiveConversationId', () => {
		it('sets conversation ID and clears messages', () => {
			const withMessages: ChatState = {
				...initialState,
				activeConversationId: 'old',
				activeConversationMessages: [{ id: '1', content: 'stale' }],
			};
			const state = chatReducer(withMessages, setActiveConversationId('new'));
			expect(state.activeConversationId).toBe('new');
			expect(state.activeConversationMessages).toEqual([]);
		});

		it('does not clear messages if same ID is set', () => {
			const existing: ChatState = {
				...initialState,
				activeConversationId: 'same',
				activeConversationMessages: [{ id: '1', content: 'keep' }],
			};
			const state = chatReducer(existing, setActiveConversationId('same'));
			expect(state.activeConversationMessages).toHaveLength(1);
		});
	});

	describe('clearActiveConversation', () => {
		it('clears both ID and messages', () => {
			const active: ChatState = {
				...initialState,
				activeConversationId: 'conv-1',
				activeConversationMessages: [{ id: '1' }],
			};
			const state = chatReducer(active, clearActiveConversation());
			expect(state.activeConversationId).toBeNull();
			expect(state.activeConversationMessages).toEqual([]);
		});
	});

	describe('setActiveConversationMessages', () => {
		it('replaces all messages', () => {
			const messages: ActiveMessage[] = [
				{ id: '1', content: 'hi', role: 'user' },
				{ id: '2', content: 'hello', role: 'assistant' },
			];
			const state = chatReducer(initialState, setActiveConversationMessages(messages));
			expect(state.activeConversationMessages).toEqual(messages);
		});
	});

	describe('appendLiveMessages', () => {
		it('appends new messages to existing array', () => {
			const withMessages: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', content: 'first' }],
			};
			const state = chatReducer(withMessages, appendLiveMessages([{ id: '2', content: 'second' }]));
			expect(state.activeConversationMessages).toHaveLength(2);
			expect(state.activeConversationMessages[1].content).toBe('second');
		});
	});

	describe('addReasoningStepById', () => {
		it('adds reasoning step to matching message', () => {
			const withMsg: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', answerMessageId: 'ans-1', reasoning: [] }],
			};
			const state = chatReducer(
				withMsg,
				addReasoningStepById({ answerMessageId: 'ans-1', reasoningStep: { text: 'thinking...' } }),
			);
			expect(state.activeConversationMessages[0].reasoning).toHaveLength(1);
		});

		it('initializes reasoning array if not present', () => {
			const withMsg: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', answerMessageId: 'ans-1' }],
			};
			const state = chatReducer(
				withMsg,
				addReasoningStepById({ answerMessageId: 'ans-1', reasoningStep: { text: 'step' } }),
			);
			expect(state.activeConversationMessages[0].reasoning).toHaveLength(1);
		});

		it('does nothing if message not found', () => {
			const withMsg: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', answerMessageId: 'ans-1' }],
			};
			const state = chatReducer(
				withMsg,
				addReasoningStepById({ answerMessageId: 'nonexistent', reasoningStep: { text: 'x' } }),
			);
			expect(state.activeConversationMessages[0].reasoning).toBeUndefined();
		});
	});

	describe('updateMessageContentById', () => {
		it('updates content, sources, reasoningDuration and removes answerMessageId', () => {
			const withMsg: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', answerMessageId: 'ans-1', content: null }],
			};
			const state = chatReducer(
				withMsg,
				updateMessageContentById({
					answerMessageId: 'ans-1',
					content: 'Final answer',
					sources: ['src1'],
					reasoningDuration: 1500,
				}),
			);
			const msg = state.activeConversationMessages[0];
			expect(msg.content).toBe('Final answer');
			expect(msg.sources).toEqual(['src1']);
			expect(msg.reasoningDuration).toBe(1500);
			expect(msg.answerMessageId).toBeUndefined();
		});

		it('does nothing if answerMessageId not found', () => {
			const withMsg: ChatState = {
				...initialState,
				activeConversationMessages: [{ id: '1', answerMessageId: 'ans-1' }],
			};
			const state = chatReducer(
				withMsg,
				updateMessageContentById({ answerMessageId: 'wrong', content: 'x' }),
			);
			expect(state.activeConversationMessages[0].answerMessageId).toBe('ans-1');
		});
	});

	describe('rename modal', () => {
		it('openRenameModal sets state correctly', () => {
			const state = chatReducer(
				initialState,
				openRenameModal({ id: 'conv-1', title: 'My Chat' }),
			);
			expect(state.isRenameModalOpen).toBe(true);
			expect(state.conversationToRename).toEqual({ id: 'conv-1', title: 'My Chat' });
		});

		it('closeRenameModal resets modal state', () => {
			const open: ChatState = {
				...initialState,
				isRenameModalOpen: true,
				conversationToRename: { id: 'conv-1', title: 'Chat' },
			};
			const state = chatReducer(open, closeRenameModal());
			expect(state.isRenameModalOpen).toBe(false);
			expect(state.conversationToRename).toBeNull();
		});
	});
});
