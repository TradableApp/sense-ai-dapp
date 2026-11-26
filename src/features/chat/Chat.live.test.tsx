import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveReasoning } from '@/hooks/useLiveReasoning';
import { initialLiveState, type LiveAnswerState } from '@/lib/liveReasoning/liveReducer';
import { expectRenderedTextIsInert, HOSTILE_LINKS, HOSTILE_MARKDOWN } from '@/test/hostileMarkdown';

import Chat from './Chat';

/**
 * The live overlay as the chat shows it: live steps and the provisional answer over a pending
 * placeholder, the composer and cancel still keyed on what is stored, no retyping when the
 * stored answer lands, and with the stream unset or unreachable the chat exactly as before.
 */
const OWNER = '0x00000000000000000000000000000000000000aa';
const chatState = vi.hoisted(() => ({
	value: { activeConversationId: '5' as string | null, activeConversationMessages: [] as object[] },
}));
const live = vi.hoisted(() => ({
	useReal: false,
	views: new Map<string, unknown>(),
	provisional: new Set<string>(),
}));
const endpoint = vi.hoisted(() => ({ value: null as { url: string; mode: string } | null }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async importOriginal => ({
	...(await importOriginal<object>()),
	useReducedMotion: () => motion.reduced,
}));
const mutation = () => ({ mutate: vi.fn(), isPending: false });

vi.mock('@/hooks/useLiveReasoning', async importOriginal => {
	const actual = await importOriginal<typeof import('@/hooks/useLiveReasoning')>();
	const fake: LiveReasoning = {
		viewFor: id => (id == null ? undefined : (live.views.get(String(id)) as LiveAnswerState)),
		hadProvisionalAnswer: id => id != null && live.provisional.has(String(id)),
	};
	return {
		default: (input: Parameters<typeof actual.default>[0]) =>
			live.useReal ? actual.default(input) : fake,
	};
});
vi.mock('@/config/reasoningStream', () => ({ default: () => endpoint.value }));
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: () => ({ status: 'open' }) }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ sessionKey: {}, ownerAddress: OWNER }),
}));
vi.mock('@/store/hooks', () => ({
	useAppDispatch: () => vi.fn(),
	useAppStore: () => ({ getState: () => ({ chat: chatState.value }) }),
	useAppSelector: (select: (_state: unknown) => unknown) =>
		select({
			chat: chatState.value,
			ui: { storageDegraded: false, storageDegradedDismissed: false },
		}),
}));
vi.mock('@/hooks/useUsagePlan', () => ({
	default: () => ({ data: { allowance: 100n, pendingEscrowCount: 1 }, isLoading: false }),
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
vi.mock('./useUnsavedSendHold', () => ({
	default: () => ({
		isComposerHeld: false,
		composerHoldReason: null,
		editHeldReason: null,
		heldReasonFor: () => null,
	}),
}));
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

const PROMPT = { id: '41', role: 'user', content: 'Where is BTC going?', conversationId: '5' };
const PLACEHOLDER = {
	id: '42',
	role: 'assistant',
	content: null,
	parentId: '41',
	conversationId: '5',
	createdAt: Date.now(),
};

const liveView = (overrides: Partial<LiveAnswerState> = {}): LiveAnswerState => ({
	...initialLiveState('42'),
	run: '0123456789abcdef',
	steps: [{ title: 'Reading market context', description: 'Checked sentiment.', attempt: 1 }],
	...overrides,
});

function renderChat() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<MemoryRouter>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</MemoryRouter>
	);
	return render(<Chat />, { wrapper });
}

const composer = () => screen.getByRole('textbox') as HTMLTextAreaElement;

beforeEach(() => {
	vi.clearAllMocks();
	live.useReal = false;
	live.views = new Map();
	live.provisional = new Set();
	endpoint.value = null;
	chatState.value = {
		activeConversationId: '5',
		activeConversationMessages: [PROMPT, PLACEHOLDER],
	};
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('the live overlay in the chat', () => {
	it('shows live steps while the answer is pending, before any content', () => {
		live.views.set('42', liveView());

		renderChat();

		const steps = screen.getByTestId('live-reasoning');
		expect(within(steps).getByText('Reading market context')).toBeTruthy();
		expect(screen.getByText('Thinking...')).toBeTruthy();
	});

	it('shows the provisional answer marked as not yet confirmed, and keeps the composer waiting', () => {
		live.views.set(
			'42',
			liveView({
				answer: { text: 'Prices rose today.', answerMessageCID: 'bafy1' },
				outcome: 'answered',
			}),
		);
		live.provisional.add('42');

		renderChat();

		const answer = screen.getByTestId('live-provisional-answer');
		expect(within(answer).getByText('Prices rose today.')).toBeTruthy();
		// The e2e page object counts stored answers by this attribute; the provisional bubble must
		// never carry "stored", or a wait for the stored answer would end on it.
		const bubbles = [...document.querySelectorAll('.is-assistant')];
		expect(bubbles.map(b => b.getAttribute('data-answer-state'))).toEqual(['provisional']);
		const mark = screen.getByRole('button', { name: 'Not yet confirmed' });
		expect(mark.getAttribute('data-testid')).toBe('live-provisional-mark');
		expect(mark.getAttribute('aria-describedby')).toBeTruthy();
		// Keyed on the stored placeholder, which has no content: still waiting, cancel still offered.
		expect(composer().disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
	});

	it('does not type the stored answer again when it lands after the provisional one', () => {
		live.views.set('42', liveView({ answer: { text: 'Prices rose.', answerMessageCID: 'bafy1' } }));
		live.provisional.add('42');
		const { rerender } = renderChat();

		live.views = new Map();
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [PROMPT, { ...PLACEHOLDER, content: 'Prices rose.' }],
		};
		act(() => rerender(<Chat />));

		expect(screen.getByText('Prices rose.')).toBeTruthy();
		expect(document.body.textContent).not.toContain('▍');
		const bubbles = [...document.querySelectorAll('.is-assistant')];
		expect(bubbles.map(b => b.getAttribute('data-answer-state'))).toEqual(['stored']);
		expect(screen.queryByTestId('live-provisional-mark')).toBeNull();
	});

	it('types a stored answer that had no provisional one, as before', () => {
		const { rerender } = renderChat();

		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [PROMPT, { ...PLACEHOLDER, content: 'Prices rose a lot.' }],
		};
		act(() => rerender(<Chat />));

		expect(document.body.textContent).toContain('▍');
	});

	it('does not type the stored answer under reduced motion', () => {
		motion.reduced = true;
		const { rerender } = renderChat();

		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [PROMPT, { ...PLACEHOLDER, content: 'Prices rose a lot.' }],
		};
		act(() => rerender(<Chat />));

		expect(screen.getByText('Prices rose a lot.')).toBeTruthy();
		expect(document.body.textContent).not.toContain('▍');
		motion.reduced = false;
	});

	it('keeps the provisional answer out of the announcements: the stored one is announced once', () => {
		live.views.set('42', liveView({ answer: { text: 'Prices rose.', answerMessageCID: 'bafy1' } }));
		live.provisional.add('42');

		renderChat();

		const answer = screen.getByTestId('live-provisional-answer');
		expect(answer.getAttribute('aria-live')).toBe('off');
	});

	it('shows the live answer of a prompt sent from another device, after that prompt', () => {
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [{ ...PROMPT, status: 'pending', answerMessageId: '42' }],
		};
		live.views.set(
			'42',
			liveView({ answer: { text: 'From the other device.', answerMessageCID: 'b' } }),
		);

		renderChat();

		expect(
			within(screen.getByTestId('live-reasoning')).getByText('Reading market context'),
		).toBeTruthy();
		expect(screen.getByText('From the other device.')).toBeTruthy();
	});

	it("hides another device's live answer only for a stored answer, never for a prompt's id", () => {
		const pending = { ...PROMPT, status: 'pending', answerMessageId: '42' };
		live.views.set('42', liveView());
		// A prompt carrying the id: not the answer, so the live turn stays.
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [{ ...PROMPT, id: '42', parentId: null }, pending],
		};
		const { unmount } = renderChat();
		expect(screen.getAllByTestId('live-reasoning')).toHaveLength(1);
		unmount();

		// The stored answer: its own turn shows what is live, and the extra turn goes.
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [pending, PLACEHOLDER],
		};
		renderChat();
		expect(screen.getAllByTestId('live-reasoning')).toHaveLength(1);
	});

	describe('after a fallback answered', () => {
		// The first attempt's step and source, then a fallback that answered with none of its own.
		const firstAttempt = {
			reasoning: [{ title: 'Reading the news', description: 'Read it.', attempt: 1 }],
			sources: [{ title: 'News', url: 'https://news.example', attempt: 1 }],
		};
		const groupsShown = () => {
			// Live steps open the reasoning by themselves; a stored answer's is opened by hand.
			const trigger = screen.getByText(/^(Thinking\.\.\.|Reasoning)$/).closest('button');
			if (trigger?.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger as Element);
			const earlier = screen.queryByTestId('reasoning-earlier-attempt');
			return {
				earlier: earlier !== null,
				latestSteps: screen
					.queryAllByTestId('reasoning-step')
					.filter(step => !earlier?.contains(step))
					.map(step => step.querySelector('h4')?.textContent),
			};
		};
		const storedAnswer = (extra: Record<string, unknown>) => {
			chatState.value = {
				activeConversationId: '5',
				activeConversationMessages: [
					PROMPT,
					{ ...PLACEHOLDER, content: 'Prices rose.', ...firstAttempt, ...extra },
				],
			};
		};

		it('shows the stored record in the same groups the live view showed', () => {
			live.views.set(
				'42',
				liveView({ attempt: 2, steps: firstAttempt.reasoning, sources: firstAttempt.sources }),
			);
			const { unmount } = renderChat();
			const shownLive = groupsShown();
			unmount();

			live.views = new Map();
			storedAnswer({ answerAttempt: 2 });
			renderChat();

			expect(shownLive).toEqual({ earlier: true, latestSteps: [] });
			expect(groupsShown()).toEqual(shownLive);
		});

		it('with no answer attempt stored, takes the highest attempt among the items, as before', () => {
			storedAnswer({});
			renderChat();

			expect(groupsShown()).toEqual({ earlier: false, latestSteps: ['Reading the news'] });
		});

		it('ignores a stored answer attempt that is not a positive safe integer', () => {
			storedAnswer({ answerAttempt: '2' });
			renderChat();

			expect(groupsShown()).toEqual({ earlier: false, latestSteps: ['Reading the news'] });
		});
	});

	it('with the stream setting unset behaves as today: no request, no error', async () => {
		live.useReal = true;
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		renderChat();
		await act(async () => {});

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(screen.queryByTestId('live-reasoning')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('Thinking...')).toBeTruthy();
	});

	it('with the stream unreachable behaves as today: no error shown', async () => {
		live.useReal = true;
		endpoint.value = { url: 'https://stream.example', mode: 'sse' };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
		);

		renderChat();
		await act(async () => {
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
		});

		expect(screen.queryByTestId('live-reasoning')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('Thinking...')).toBeTruthy();
	});
});

describe('conversation text in the chat renders inert', () => {
	// Every place the chat renders conversation text: the user's prompt, the stored answer, the
	// provisional answer, and the live steps and sources. Nothing in them loads or links unsafely.
	it("renders the user's prompt and the stored answer inert", () => {
		motion.reduced = true;
		chatState.value = {
			activeConversationId: '5',
			activeConversationMessages: [
				{ ...PROMPT, content: HOSTILE_MARKDOWN },
				{ ...PLACEHOLDER, content: HOSTILE_MARKDOWN },
			],
		};

		renderChat();

		const rendered = [...document.querySelectorAll<HTMLElement>('.prose')];
		expect(rendered).toHaveLength(2);
		rendered.forEach(text => {
			expect(text.textContent).toContain('inline alt');
			expect(expectRenderedTextIsInert(text)).toHaveLength(3);
		});
		motion.reduced = false;
	});

	it('renders the provisional answer inert', () => {
		live.views.set('42', liveView({ answer: { text: HOSTILE_MARKDOWN, answerMessageCID: 'b' } }));
		live.provisional.add('42');

		renderChat();

		const answer = screen.getByTestId('live-provisional-answer');
		expect(expectRenderedTextIsInert(answer)).toHaveLength(3);
	});

	it('renders live steps as text and links only web sources', () => {
		live.views.set(
			'42',
			liveView({
				steps: [
					{ title: '![t](https://img.example/t.png)', description: HOSTILE_MARKDOWN, attempt: 1 },
				],
				sources: [
					...Object.values(HOSTILE_LINKS).map(url => ({ title: 'Unsafe', url, attempt: 1 })),
					{ title: 'News', url: 'https://news.example/a', attempt: 1 },
				],
			}),
		);

		renderChat();
		fireEvent.click(screen.getByText(/^Used \d+ sources$/));

		const reasoning = screen.getByTestId('live-reasoning');
		const links = expectRenderedTextIsInert(reasoning);
		expect(links.map(link => link.getAttribute('href'))).toEqual(['https://news.example/a']);
		expect(reasoning.textContent).toContain('![t](https://img.example/t.png)');
	});
});

describe('conversation text in the chat is kept out of analytics', () => {
	// Autocapture records nothing inside `ph-no-capture`, and replay blocks it whole.
	const isUnrecorded = (el: Element) => el.closest('.ph-no-capture') !== null;

	it('marks the prompt, the answers, the live steps and the composer', () => {
		live.views.set('42', liveView({ answer: { text: 'Prices rose.', answerMessageCID: 'b' } }));
		live.provisional.add('42');

		renderChat();

		expect(isUnrecorded(screen.getByText('Where is BTC going?'))).toBe(true);
		expect(isUnrecorded(screen.getByTestId('live-provisional-answer'))).toBe(true);
		expect(isUnrecorded(screen.getByTestId('live-reasoning'))).toBe(true);
		expect(isUnrecorded(composer())).toBe(true);
		expect(isUnrecorded(screen.getByRole('log'))).toBe(true);
	});
});
