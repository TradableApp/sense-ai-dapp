import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addMessageToConversation } from '@/lib/dataService';
import { appendLiveMessages, setActiveConversationId } from '@/store/chatSlice';

import Chat from './Chat';
import useUnsavedSendHold from './useUnsavedSendHold';

/**
 * The chat around a paid send that was confirmed and not saved here: the composer is held
 * while its conversation is, a save with no wallet address fails rather than passing, and
 * the composer's failure shows the prompt from the receipt's ids so it can be cancelled.
 */
const OWNER = '0x00000000000000000000000000000000000000aa';
const session = vi.hoisted(() => ({
	value: { sessionKey: {}, ownerAddress: '' as string | null },
}));
const dispatch = vi.hoisted(() => vi.fn());
const chatState = vi.hoisted(() => ({
	value: {
		activeConversationId: null as string | null,
		activeConversationMessages: [] as object[],
	},
}));
const promptMutate = vi.hoisted(() => vi.fn());
const mutation = () => ({ mutate: vi.fn(), isPending: false });

vi.mock('@/hooks/usePromptsSwitch', () => ({ default: () => ({ status: 'open' }) }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));
vi.mock('@/features/auth/SessionProvider', () => ({ useSession: () => session.value }));
vi.mock('@/store/hooks', () => ({
	useAppDispatch: () => dispatch,
	// What the store holds at the moment it is asked, which a test changes after rendering.
	useAppStore: () => ({ getState: () => ({ chat: chatState.value }) }),
	useAppSelector: (select: (_state: unknown) => unknown) =>
		select({
			chat: chatState.value,
			ui: { storageDegraded: false, storageDegradedDismissed: false },
		}),
}));
vi.mock('@/hooks/useUsagePlan', () => ({
	default: () => ({ data: { allowance: 100n, pendingEscrowCount: 0 }, isLoading: false }),
}));
vi.mock('@/hooks/useChatMutations', () => ({ default: () => ({}) }));
vi.mock('./useOneSendAtATime', () => ({
	default: () => ({
		initiatePromptMutation: { mutate: promptMutate, isPending: false },
		regenerateMutation: mutation(),
		branchConversationMutation: mutation(),
		cancelPromptMutation: mutation(),
		processRefundMutation: mutation(),
		isSending: false,
	}),
}));
vi.mock('./useHeldBranchRefresh', () => ({ default: () => false }));
vi.mock('./useUnsavedSendHold', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useConversations', () => ({ default: () => ({ data: [] }) }));
vi.mock('@/hooks/useFirestoreCollectionListener', () => ({ default: () => undefined }));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb/react', () => ({
	useActiveAccount: () => undefined,
	useActiveWallet: () => undefined,
	useActiveWalletChain: () => undefined,
	AccountProvider: ({ children }: { children: ReactNode }) => children,
	AccountAvatar: () => null,
	Blobbie: () => null,
}));
vi.mock('@/lib/feedbackService', () => ({ default: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn() }));
vi.mock('@/lib/dataService', () => ({
	addMessageToConversation: vi.fn(),
	branchConversation: vi.fn(),
	createNewConversation: vi.fn(),
	deleteMessageFromConversation: vi.fn(),
	editUserMessage: vi.fn(),
	getConversation: vi.fn(async () => null),
	getMessagesForConversation: vi.fn(async () => []),
	regenerateAssistantResponse: vi.fn(),
}));

function renderChat() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<MemoryRouter>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</MemoryRouter>
	);
	render(<Chat />, { wrapper });
}

const composer = () => screen.getByRole('textbox') as HTMLTextAreaElement;

/** Types a prompt, sends it, and gives back the options the chat passed to `mutate`. */
async function sendPrompt(text = 'What is the market doing?') {
	await act(async () => {
		fireEvent.change(composer(), { target: { value: text } });
	});
	await act(async () => {
		fireEvent.submit(composer().closest('form') as HTMLFormElement);
	});
	expect(promptMutate).toHaveBeenCalledTimes(1);
	return promptMutate.mock.calls[0][1] as {
		onSuccess: (_ids: object) => Promise<void>;
		onSaveFailed: (_ids: object, _confirmedAt?: number) => void;
	};
}

const NOT_HELD = {
	isComposerHeld: false,
	composerHoldReason: null,
	editHeldReason: null,
	heldReasonFor: () => null,
};

/** A conversation with one answered prompt, open in the chat. */
const OPEN_CONVERSATION = {
	activeConversationId: '5',
	activeConversationMessages: [
		{ id: '3', role: 'user', content: 'q', conversationId: '5' },
		{ id: '4', role: 'assistant', content: 'a', parentId: '3', conversationId: '5' },
	],
};

const actionsOfType = (type: string) =>
	dispatch.mock.calls.map(([action]) => action).filter(action => action.type === type);

const IDS = { conversationId: '9', promptMessageId: '11', answerMessageId: '12' };

beforeEach(() => {
	vi.clearAllMocks();
	session.value = { sessionKey: {}, ownerAddress: OWNER };
	chatState.value = { activeConversationId: null, activeConversationMessages: [] };
	vi.mocked(useUnsavedSendHold).mockReturnValue(NOT_HELD);
});

afterEach(cleanup);

describe('the composer while a paid send is not saved here', () => {
	it('cannot send and says why', async () => {
		vi.mocked(useUnsavedSendHold).mockReturnValue({
			...NOT_HELD,
			isComposerHeld: true,
			composerHoldReason: 'Held: the reason.',
		});
		renderChat();

		expect(composer().disabled).toBe(true);
		const notice = screen.getByTestId('unsaved-send-hold');
		expect(notice.textContent).toBe('Held: the reason.');
		expect(composer().getAttribute('aria-describedby')).toContain('unsaved-send-hold');
	});

	it('sends again once nothing is held', async () => {
		renderChat();

		expect(composer().disabled).toBe(false);
		expect(screen.getByTestId('unsaved-send-hold').textContent).toBe('');
	});
});

describe('a confirmed prompt', () => {
	// Returning would resolve the save as if it worked: no warning, the composer not cleared,
	// and the paid text could be sent again.
	it('with no wallet address fails its save instead of passing', async () => {
		session.value = { sessionKey: {}, ownerAddress: null };
		renderChat();
		const { onSuccess } = await sendPrompt();

		await expect(onSuccess(IDS)).rejects.toThrow(/wallet address/);
	});

	it('whose save failed is shown from the receipt, in a new conversation, awaiting its answer', async () => {
		renderChat();
		const { onSaveFailed } = await sendPrompt('A new question');

		act(() => onSaveFailed(IDS));

		expect(dispatch).toHaveBeenCalledWith(setActiveConversationId('9'));
		const shown = dispatch.mock.calls
			.map(([action]) => action)
			.find(action => action.type === 'chat/setActiveConversationMessages');
		expect(shown?.payload).toEqual([
			expect.objectContaining({ id: '11', role: 'user', content: 'A new question' }),
			expect.objectContaining({ id: '12', role: 'assistant', content: null, parentId: '11' }),
		]);
		expect(composer().value).toBe('');
	});

	it('whose save failed in a conversation is added to it from the receipt', async () => {
		chatState.value = OPEN_CONVERSATION;
		renderChat();
		const { onSaveFailed } = await sendPrompt('A follow-up');

		act(() => onSaveFailed({ ...IDS, conversationId: '5' }));

		const added = dispatch.mock.calls
			.map(([action]) => action)
			.find(action => action.type === appendLiveMessages.type);
		expect(added?.payload).toEqual([
			expect.objectContaining({ id: '11', parentId: '4', content: 'A follow-up' }),
			expect.objectContaining({ id: '12', parentId: '11', content: null }),
		]);
	});
});

describe('a confirmed prompt whose conversation is no longer open', () => {
	// The user opened another conversation while the send was saved: the prompt must not be
	// shown in it, its cancel must not act on it, and its draft is the user's own.
	it('whose save failed shows nothing in the open one and leaves its draft alone', async () => {
		chatState.value = OPEN_CONVERSATION;
		renderChat();
		const { onSaveFailed } = await sendPrompt('A follow-up');
		chatState.value = { activeConversationId: '6', activeConversationMessages: [] };
		await act(async () => {
			fireEvent.change(composer(), { target: { value: 'A new draft' } });
		});

		act(() => onSaveFailed({ ...IDS, conversationId: '5' }));

		expect(actionsOfType(appendLiveMessages.type)).toEqual([]);
		expect(actionsOfType(setActiveConversationId.type)).toEqual([]);
		expect(composer().value).toBe('A new draft');
	});

	it('whose save finished late shows nothing in the open one and leaves its draft alone', async () => {
		vi.mocked(addMessageToConversation).mockResolvedValue({
			finalUserMessage: { id: '11' },
			finalAiMessage: { id: '12' },
		} as never);
		chatState.value = OPEN_CONVERSATION;
		renderChat();
		const { onSuccess } = await sendPrompt('A follow-up');
		chatState.value = { activeConversationId: '6', activeConversationMessages: [] };
		await act(async () => {
			fireEvent.change(composer(), { target: { value: 'A new draft' } });
		});

		await act(async () => {
			await onSuccess({ ...IDS, conversationId: '5' });
		});

		expect(addMessageToConversation).toHaveBeenCalledTimes(1);
		expect(actionsOfType(appendLiveMessages.type)).toEqual([]);
		expect(composer().value).toBe('A new draft');
	});

	it('that started a conversation does not move the user out of the one they opened', async () => {
		renderChat();
		const { onSaveFailed } = await sendPrompt('A new question');
		chatState.value = OPEN_CONVERSATION;

		act(() => onSaveFailed(IDS));

		expect(actionsOfType(setActiveConversationId.type)).toEqual([]);
		expect(actionsOfType('chat/setActiveConversationMessages')).toEqual([]);
	});
});

describe('a confirmed prompt whose save failed, shown from its receipt', () => {
	// The refund countdown runs from the prompt's time: the confirmation, not the failure.
	it('carries the time it was confirmed', async () => {
		renderChat();
		const { onSaveFailed } = await sendPrompt('A new question');
		const confirmedAt = Date.now() - 30_000;

		act(() => onSaveFailed(IDS, confirmedAt));

		const [shown] = actionsOfType('chat/setActiveConversationMessages');
		expect(shown.payload[0].createdAt).toBe(confirmedAt);
		expect(shown.payload[1].createdAt).toBe(confirmedAt + 1);
	});
});

describe('the controls a held conversation switches off', () => {
	it("passes the answer's held reason to its regenerate and branch", () => {
		chatState.value = OPEN_CONVERSATION;
		vi.mocked(useUnsavedSendHold).mockReturnValue({
			...NOT_HELD,
			heldReasonFor: (id: string | number | null | undefined) =>
				String(id) === '4' ? 'Held answer.' : null,
		});
		renderChat();

		const tryAgain = screen.getByRole('button', { name: 'Try again' });
		expect(tryAgain.getAttribute('aria-disabled')).toBe('true');
	});

	it('passes the edit hold to the edit control', () => {
		chatState.value = OPEN_CONVERSATION;
		vi.mocked(useUnsavedSendHold).mockReturnValue({ ...NOT_HELD, editHeldReason: 'Held edit.' });
		renderChat();

		const edit = screen.getByRole('button', { name: 'Edit message' });
		expect(edit.getAttribute('aria-disabled')).toBe('true');
	});

	it('reads the stored messages for the hold, not the ones shown', () => {
		chatState.value = OPEN_CONVERSATION;
		renderChat();

		const [input] = vi.mocked(useUnsavedSendHold).mock.calls.at(-1) ?? [];
		// The store mock returns no messages while two are shown.
		expect(input?.storedMessages ?? []).toEqual([]);
	});
});
