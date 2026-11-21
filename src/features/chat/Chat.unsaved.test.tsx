import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
		onSaveFailed: (_ids: object) => void;
	};
}

const IDS = { conversationId: '9', promptMessageId: '11', answerMessageId: '12' };

beforeEach(() => {
	vi.clearAllMocks();
	session.value = { sessionKey: {}, ownerAddress: OWNER };
	chatState.value = { activeConversationId: null, activeConversationMessages: [] };
	vi.mocked(useUnsavedSendHold).mockReturnValue({
		isComposerHeld: false,
		heldReasonFor: () => null,
	});
});

afterEach(cleanup);

describe('the composer while a paid send is not saved here', () => {
	it('cannot send and says why', async () => {
		vi.mocked(useUnsavedSendHold).mockReturnValue({
			isComposerHeld: true,
			heldReasonFor: () => null,
		});
		renderChat();

		expect(composer().disabled).toBe(true);
		const notice = screen.getByTestId('unsaved-send-hold');
		expect(notice.textContent).toMatch(/not shown on this device yet/);
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
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [
				{ id: '3', role: 'user', content: 'q', conversationId: '5' },
				{ id: '4', role: 'assistant', content: 'a', parentId: '3', conversationId: '5' },
			],
		};
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
