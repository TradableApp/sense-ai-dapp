import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import usePromptsSwitch from '@/hooks/usePromptsSwitch';

import Chat from './Chat';

/**
 * The composer as rendered: a closed switch greys it out, an open one does not. The payment
 * guard pins the flag in the source; this shows the rendered controls follow it.
 */
const mutation = () => ({ mutate: vi.fn(), isPending: false });

vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({
		sessionKey: {},
		ownerAddress: '0x00000000000000000000000000000000000000aa',
	}),
}));
vi.mock('@/store/hooks', () => ({
	useAppDispatch: () => vi.fn(),
	useAppStore: () => ({ getState: () => ({ chat: { activeConversationId: null } }) }),
	useAppSelector: (select: (_state: unknown) => unknown) =>
		select({
			chat: { activeConversationId: null, activeConversationMessages: [] },
			ui: { storageDegraded: false, storageDegradedDismissed: false },
		}),
}));
vi.mock('@/hooks/useUsagePlan', () => ({
	default: () => ({ data: { allowance: 100n, pendingEscrowCount: 0 }, isLoading: false }),
}));
vi.mock('@/hooks/useChatMutations', () => ({ default: () => ({}) }));
vi.mock('./useOneSendAtATime', () => ({
	default: () => ({
		initiatePromptMutation: mutation(),
		regenerateMutation: mutation(),
		branchConversationMutation: mutation(),
		cancelPromptMutation: mutation(),
		processRefundMutation: mutation(),
		isSending: false,
	}),
}));
vi.mock('./useHeldBranchRefresh', () => ({ default: () => false }));
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
	getConversation: vi.fn(),
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
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;

async function typePrompt() {
	await act(async () => {
		fireEvent.change(composer(), { target: { value: 'What is the market doing?' } });
	});
}

beforeEach(() => {
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
});

afterEach(cleanup);

describe('the chat composer and the prompts switch', () => {
	it('is greyed out, send included, while prompts are closed', async () => {
		vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording: 'incident' });
		renderChat();
		await typePrompt();

		expect(composer().disabled).toBe(true);
		expect(sendButton().disabled).toBe(true);
	});

	it('takes a prompt while the switch is open', async () => {
		renderChat();
		await typePrompt();

		expect(composer().disabled).toBe(false);
		expect(sendButton().disabled).toBe(false);
	});
});
