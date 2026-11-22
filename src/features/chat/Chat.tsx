import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where } from 'firebase/firestore';
import { Loader2, MicIcon, RotateCcwIcon, Split } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { z } from 'zod';

import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai/conversation';
import EditPromptInput from '@/components/ai/edit-prompt-input';
import Loader from '@/components/ai/loader';
import { Message, MessageAvatar, MessageContent } from '@/components/ai/message';
import MessageActions from '@/components/ai/message-actions';
import {
	PromptInput,
	PromptInputButton,
	PromptInputCancel,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from '@/components/ai/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai/reasoning';
import UserMessageActions from '@/components/ai/user-message-actions';
import StorageUnavailableBanner from '@/components/StorageUnavailableBanner';
import { Button } from '@/components/ui/button';
import { db } from '@/config/firebase';
import { useSession } from '@/features/auth/SessionProvider';
import useChatMutations from '@/hooks/useChatMutations';
import useConversations from '@/hooks/useConversations';
import useFirestoreCollectionListener from '@/hooks/useFirestoreCollectionListener';
import usePaymentGate from '@/hooks/usePaymentGate';
import useUsagePlan from '@/hooks/useUsagePlan';
import { CANCELLATION_TIMEOUT_MS } from '@/lib/constants';
import {
	addMessageToConversation,
	branchConversation,
	createNewConversation,
	deleteMessageFromConversation,
	editUserMessage,
	getConversation,
	getMessagesForConversation,
	regenerateAssistantResponse,
} from '@/lib/dataService';
import { secondsUntilRefund } from '@/lib/refund';
import {
	type ActiveMessage,
	appendLiveMessages,
	clearActiveConversation,
	setActiveConversationId,
	setActiveConversationMessages,
} from '@/store/chatSlice';
import { useAppDispatch, useAppSelector, useAppStore } from '@/store/hooks';

import ActivatePlanCTA from './ActivatePlanCTA';
import { cancelWindow } from './cancelWindow';
import ComposerHoldNotices, { composerHoldDescription } from './ComposerHoldNotices';
import isQueryAhead from './messageReconcile';
import { composerStateFor } from './promptParent';
import showUnsavedPrompt, { isActiveConversation, noWalletAddressError } from './unsavedPrompt';
import useHeldBranchRefresh from './useHeldBranchRefresh';
import useOneSendAtATime from './useOneSendAtATime';
import useUnsavedSendHold from './useUnsavedSendHold';

interface MarkdownParagraphProps {
	children: ReactNode;
}

function MarkdownParagraph({ children }: MarkdownParagraphProps) {
	return <p className="inline">{children}</p>;
}
const markdownComponents: Record<string, FC<any>> = { p: MarkdownParagraph };

interface BranchInfoProps {
	originalConversationId: string | number;
	onNavigate: (_id: string | number) => void;
}

function BranchInfo({ originalConversationId, onNavigate }: BranchInfoProps) {
	const { data: conversations } = useConversations();
	const originalConversation = conversations?.find(c => c.id === originalConversationId);

	if (!originalConversation) return null;

	return (
		<div className="flex items-center justify-center p-2 text-sm">
			<button
				type="button"
				onClick={() => onNavigate(originalConversationId)}
				className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
			>
				<Split className="size-4 rotate-90" />
				See original conversation{' '}
				<span className="font-semibold text-primary">{originalConversation.title}</span>
			</button>
		</div>
	);
}

const STREAM_BY_WORD = true;

const promptSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(5000),
});

export default function Chat() {
	const dispatch = useAppDispatch();
	const store = useAppStore();
	// Read from the store when asked: a save that ends after another conversation was opened
	// must not act on the one open now.
	const isStillActive = (id: string | number | null | undefined) =>
		isActiveConversation(store.getState(), id);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { sessionKey, ownerAddress } = useSession();
	const { activeConversationId, activeConversationMessages } = useAppSelector(state => state.chat);

	const { data: plan, isLoading: isLoadingPlan } = useUsagePlan();
	const hasActivePlan = !!plan;

	const {
		initiatePromptMutation,
		regenerateMutation,
		branchConversationMutation,
		cancelPromptMutation,
		processRefundMutation,
		isSending,
	} = useOneSendAtATime(useChatMutations());

	const [animatedContents, setAnimatedContents] = useState<Record<string, string>>({});
	const activeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	const prevMessagesRef = useRef<ActiveMessage[]>([]);
	// answerMessageIds the user just cancelled/refunded. Their optimistic answer placeholder is
	// removed from Redux immediately, but a not-yet-refreshed query can still carry it and
	// re-hydrate it (the cache drop via syncService.dropCancelledAnswerPlaceholders is eventual).
	// isQueryAhead can't tell a dropped-cancelled placeholder from a fresh pending one, so we
	// filter these ids out on every hydrate to keep the composer from re-sticking on "Thinking…".
	const cancelledAnswerIdsRef = useRef<Set<string>>(new Set());
	const [activeMessageId, setActiveMessageId] = useState<string | number | null>(null);
	const [editingMessageId, setEditingMessageId] = useState<string | number | null>(null);
	const prevMessageCountRef = useRef(0);
	const [feedbackData, setFeedbackData] = useState<Record<string, number>>({});
	const [cancelDeadline, setCancelDeadline] = useState<number | null>(null);
	// Wall clock the cancel affordance is computed against; ticked while the window is closed.
	const [cancelClock, setCancelClock] = useState(() => Date.now());
	const cancelAffordance = cancelWindow(cancelDeadline, cancelClock);
	const [refundSecondsLeft, setRefundSecondsLeft] = useState<number | null>(null);

	const {
		register,
		handleSubmit,
		reset,
		getValues,
		formState: { errors, isSubmitting, isValid },
	} = useForm({
		resolver: zodResolver(promptSchema),
		mode: 'onChange',
		defaultValues: { prompt: '' },
	});

	const { data: conversations } = useConversations();
	const currentConversation = conversations?.find(c => c.id === activeConversationId);

	const {
		data: activeConversationMetadata,
		isFetched: isMetadataFetched,
		isFetching: isMetadataFetching,
	} = useQuery({
		queryKey: ['conversations', 'metadata', activeConversationId, sessionKey, ownerAddress],
		queryFn: () => {
			if (!sessionKey || !ownerAddress || !activeConversationId) return null;
			return getConversation(sessionKey, ownerAddress, activeConversationId);
		},
		enabled: !!activeConversationId && !!sessionKey && !!ownerAddress,
		// We want this to be fresh, so we don't cache it for long
		staleTime: 0,
	});

	const {
		data: messagesFromQuery,
		isLoading,
		isSuccess,
		isFetching,
	} = useQuery({
		queryKey: ['messages', activeConversationId, ownerAddress],
		queryFn: () => {
			if (!activeConversationId || !sessionKey || !ownerAddress) return [];
			return getMessagesForConversation(sessionKey, ownerAddress, activeConversationId);
		},
		enabled: !!activeConversationId && !!sessionKey && !!ownerAddress,
		refetchOnWindowFocus: false,
		refetchOnMount: true,
	});

	useEffect(() => {
		if (!isFetching && isSuccess && messagesFromQuery) {
			const queryMessages = messagesFromQuery as unknown as ActiveMessage[];
			const shouldHydrate = isQueryAhead(activeConversationMessages, queryMessages);

			if (shouldHydrate) {
				// Drop any cancelled/refunded answer placeholder the query still carries before its
				// cache eviction has propagated — otherwise it re-sticks the composer on "Thinking…".
				const cancelled = cancelledAnswerIdsRef.current;
				const hydrated =
					cancelled.size === 0
						? queryMessages
						: queryMessages.filter(m => m.id == null || !cancelled.has(String(m.id)));
				dispatch(setActiveConversationMessages(hydrated));
			}
		}
	}, [isFetching, isSuccess, messagesFromQuery, activeConversationMessages, dispatch]);

	const { messagesToDisplay, versionInfo } = useMemo(() => {
		const allMessages = activeConversationMessages;

		if (!allMessages || allMessages.length === 0) {
			return { messagesToDisplay: [], versionInfo: {} };
		}

		const messageMap = new Map(allMessages.map(m => [String(m.id ?? ''), m]));
		const parentToChildrenMap = allMessages.reduce((acc, msg) => {
			const parentKey = String(msg.parentId ?? '');
			if (!acc[parentKey]) acc[parentKey] = [];
			acc[parentKey].push(msg);
			return acc;
		}, {} as Record<string, ActiveMessage[]>);

		const versions: Record<
			string,
			{ siblings: (string | number | undefined)[]; currentIndex: number }
		> = {};
		Object.keys(parentToChildrenMap).forEach(parentId => {
			const children = parentToChildrenMap[parentId];
			if (children.length > 1) {
				const siblings = children.sort((a, b) => {
					const aTime = a.createdAt ?? 0;
					const bTime = b.createdAt ?? 0;
					return aTime - bTime;
				});
				siblings.forEach((msg, index) => {
					const msgId = String(msg.id ?? '');
					if (msgId) {
						versions[msgId] = { siblings: siblings.map(s => s.id), currentIndex: index };
					}
				});
			}
		});

		const displayPath: ActiveMessage[] = [];

		// If activeMessageId is set but doesn't exist in the map (e.g. it was just deleted),
		// fall back to the latest message in the list.
		let currentId: string | undefined = activeMessageId
			? String(activeMessageId)
			: String(allMessages.at(-1)?.id ?? '');
		if (!currentId || !messageMap.has(currentId)) {
			const lastMsg = allMessages.at(-1);
			currentId = lastMsg ? String(lastMsg.id) : undefined;
		}

		// Trace path backwards
		while (currentId && messageMap.has(currentId)) {
			const message = messageMap.get(currentId);
			if (message) {
				displayPath.unshift(message);
				currentId = message.parentId ? String(message.parentId) : undefined;
			} else {
				break;
			}
		}

		return { messagesToDisplay: displayPath, versionInfo: versions };
	}, [activeConversationMessages, activeMessageId]);

	// Whether a prompt can be sent now and what it threads off: see composerStateFor. The
	// record comes from the list or, when the list does not have it yet (a branch just made, a
	// sync still running), from the direct read of this one conversation.
	const composer = composerStateFor({
		activeConversationId,
		conversation: currentConversation ?? activeConversationMetadata,
		// Fetched and not being fetched again: `isFetched` stays true from an earlier visit, when
		// the record may not have existed yet.
		isConversationSettled: isMetadataFetched && !isMetadataFetching,
		messagesShown: messagesToDisplay,
		// Read, and what was read is what is shown. The third clause is needed: the store is
		// emptied when the conversation changes and filled one render AFTER the read returns, so
		// in between the read has messages and the screen has none.
		areMessagesSettled:
			isSuccess &&
			!isFetching &&
			((messagesFromQuery?.length ?? 0) === 0 || activeConversationMessages.length > 0),
	});
	// Nothing is sent while the payment gate refuses prompts (the prompts switch is closed, or
	// the chain disagrees about the token). The mutations refuse too; this greys the composer.
	const paymentGate = usePaymentGate();
	const arePromptsSwitchedOff = paymentGate.blocks('prompt');
	const hasBranchOrigin = composer.kind === 'ready' && composer.hasBranchOrigin;
	// True from the moment the branch is held until it can send, re-reads included.
	const isHeldForBranchHistory = useHeldBranchRefresh({
		composerKind: composer.kind,
		activeConversationId,
		ownerAddress,
		sessionKey,
		queryClient,
	});
	// Held while a paid send from here was confirmed but not saved on this device.
	const unsavedSend = useUnsavedSendHold({
		queryClient,
		activeConversationId,
		ownerAddress,
		storedMessages: messagesFromQuery,
		conversations,
	});
	// The prompt shown from its receipt, kept with its hold: shown again when this conversation
	// is opened again, with its cancel control, until the hold ends.
	const { shownPrompt } = unsavedSend;
	useEffect(() => {
		if (!shownPrompt) return;
		const shownIds = new Set(activeConversationMessages.map(message => String(message.id)));
		const missing = shownPrompt.filter(message => !shownIds.has(String(message.id)));
		if (missing.length > 0) dispatch(appendLiveMessages(missing as unknown as ActiveMessage[]));
	}, [shownPrompt, activeConversationMessages, dispatch]);

	useEffect(() => {
		setActiveMessageId(null);
		setEditingMessageId(null);
		prevMessageCountRef.current = 0;
		prevMessagesRef.current = [];
		cancelledAnswerIdsRef.current = new Set();
	}, [activeConversationId]);

	const handleReset = useCallback((): void => {
		dispatch(clearActiveConversation());
		setAnimatedContents({});
		Object.values(activeTimersRef.current).forEach(timer => {
			clearInterval(timer);
		});
		activeTimersRef.current = {};
		prevMessagesRef.current = [];
		setActiveMessageId(null);
		prevMessageCountRef.current = 0;
	}, [dispatch]);

	// Detect if the active conversation was deleted (e.g. by another tab)
	useEffect(() => {
		if (activeConversationId && activeConversationMetadata?.isDeleted) {
			toast.info('Conversation was deleted.');

			handleReset();
		}
	}, [activeConversationId, activeConversationMetadata?.isDeleted, handleReset]);

	useEffect(() => {
		if (
			activeConversationMessages &&
			activeConversationMessages.length > prevMessageCountRef.current
		) {
			setActiveMessageId(activeConversationMessages.at(-1)?.id ?? null);
		} else if (!activeMessageId && activeConversationMessages?.length) {
			setActiveMessageId(activeConversationMessages.at(-1)?.id ?? null);
		}
		prevMessageCountRef.current = activeConversationMessages?.length || 0;
	}, [activeMessageId, activeConversationMessages]);

	useEffect(
		() => () => {
			Object.values(activeTimersRef.current).forEach(timer => {
				clearInterval(timer);
			});
		},
		[],
	);

	const handleRegenerate = (aiMessageToRegenerate: ActiveMessage, mode: string = 'default') => {
		const userPrompt = activeConversationMessages.find(
			m => m.id === aiMessageToRegenerate.parentId,
		);
		if (!userPrompt) return;

		// Map UI modes to natural language instructions
		const instructionMap: Record<string, string> = {
			default: 'better',
			detailed: 'more detailed',
			concise: 'more concise',
		};
		const instructions = instructionMap[mode] || 'better';

		if (!sessionKey || !activeConversationId) return;

		regenerateMutation.mutate(
			{
				conversationId: activeConversationId,
				promptMessageId: userPrompt.id ?? 0,
				promptMessageCID: userPrompt.messageCID ?? '',
				originalAnswerMessageId: aiMessageToRegenerate.id ?? 0,
				instructions,
				sessionKey,
				originalAnswerMessageCID: aiMessageToRegenerate.messageCID ?? '',
			},
			{
				onSuccess: async ({ newAnswerMessageId }) => {
					if (!ownerAddress) throw noWalletAddressError();
					const { finalAiMessage } = await regenerateAssistantResponse(
						sessionKey,
						ownerAddress,
						activeConversationId,
						String(userPrompt.id ?? ''),
						userPrompt.content ?? '',
						mode,
						newAnswerMessageId,
						queryClient,
					);
					if (!isStillActive(activeConversationId)) return;
					dispatch(appendLiveMessages([finalAiMessage as unknown as ActiveMessage]));
				},
				// onError: () => {},
			},
		);
	};

	const handleSaveEdit = (data: { content: string }) => {
		const originalMessage = activeConversationMessages.find(m => m.id === editingMessageId);

		if (!originalMessage) {
			return;
		}

		// Find parent to get CID for context reconstruction
		const parentMessage = activeConversationMessages.find(m => m.id === originalMessage.parentId);

		if (!sessionKey || !activeConversationId) return;

		initiatePromptMutation.mutate(
			{
				conversationId: activeConversationId,
				promptText: data.content,
				sessionKey,
				parentId: originalMessage.parentId ?? null,
				parentCID: parentMessage?.messageCID ?? null,
				// An edit is made on a message that is shown, so the composer is ready here.
				hasBranchOrigin,
			},
			{
				onSuccess: async newIds => {
					if (!ownerAddress) throw noWalletAddressError();
					const parentId = originalMessage.parentId ?? 0;
					const { finalUserMessage, finalAiMessage } = await editUserMessage(
						sessionKey,
						ownerAddress,
						activeConversationId,
						String(parentId ?? ''),
						data.content,
						newIds.promptMessageId,
						newIds.answerMessageId,
						queryClient,
					);
					if (!isStillActive(activeConversationId)) return;
					dispatch(
						appendLiveMessages([
							finalUserMessage as unknown as ActiveMessage,
							finalAiMessage as unknown as ActiveMessage,
						]),
					);
					setEditingMessageId(null);
				},
				// Sent and paid for, not saved here: the edit is closed so it is not sent again, unless
				// another conversation is open now, whose edit box is the user's own.
				onSaveFailed: () => {
					if (isStillActive(activeConversationId)) setEditingMessageId(null);
				},
				// onError: () => {},
			},
		);
	};

	const handleNavigate = (targetBranchRootId: string | number) => {
		const allMessages = activeConversationMessages;
		if (!allMessages) {
			return;
		}

		const messageMap = new Map(allMessages.map(m => [String(m.id), m]));

		const parentToChildrenMap = allMessages.reduce((acc, msg) => {
			const parentKey = String(msg.parentId ?? '');
			if (!acc[parentKey]) acc[parentKey] = [];
			acc[parentKey].push(msg);
			return acc;
		}, {} as Record<string, ActiveMessage[]>);

		let latestMessageInBranch = messageMap.get(String(targetBranchRootId));

		if (!latestMessageInBranch) return;

		const queue: ActiveMessage[] = [latestMessageInBranch];
		while (queue.length > 0) {
			const [currentNode] = queue.splice(0, 1);

			if (currentNode && latestMessageInBranch) {
				const currentTime = currentNode.createdAt ?? 0;
				const latestTime = latestMessageInBranch.createdAt ?? 0;
				if (currentTime > latestTime) {
					latestMessageInBranch = currentNode;
				}

				const children = parentToChildrenMap[String(currentNode.id ?? '')];

				if (children) {
					queue.push(...children);
				}
			}
		}

		if (latestMessageInBranch?.id !== undefined) {
			setActiveMessageId(latestMessageInBranch.id);
		}
	};

	const handleBranch = (messageToBranchFrom: ActiveMessage) => {
		if (!conversations) return;
		const conversation = conversations.find(c => c.id === activeConversationId);
		if (!conversation) {
			return;
		}

		if (!sessionKey || !activeConversationId) return;

		branchConversationMutation.mutate(
			{
				originalConversationId: activeConversationId,
				branchPointMessageId: messageToBranchFrom.id ?? 0,
				originalTitle: conversation.title,
				sessionKey,
			},
			{
				onSuccess: async ({ newConversationId }) => {
					if (!ownerAddress) throw noWalletAddressError();
					await branchConversation(
						sessionKey,
						ownerAddress,
						activeConversationId,
						String(messageToBranchFrom.id ?? 0),
						newConversationId,
						queryClient,
					);
					// The new branch is opened, unless the user has opened another conversation since.
					if (!isStillActive(activeConversationId)) return;

					dispatch(setActiveConversationId(newConversationId));
					// const newMessages = await getMessagesForConversation(
					// 	sessionKey,
					// 	ownerAddress,
					// 	newConversationId,
					// );
					// dispatch(setActiveConversationMessages(newMessages));
				},
				// onError: () => {},
			},
		);
	};

	const simulateTyping = (message: ActiveMessage) => {
		const targetContent = message.content;
		const msgId = String(message.id ?? '');
		if (!targetContent || !msgId) return;

		const streamFn = STREAM_BY_WORD
			? (content: string, i: number) =>
					content
						.split(' ')
						.slice(0, i + 1)
						.join(' ')
			: (content: string, i: number) => content.slice(0, i + 1);
		const interval = STREAM_BY_WORD ? 120 : 50;
		let index = 0;
		setAnimatedContents(prev => ({ ...prev, [msgId]: '' }));
		if (activeTimersRef.current[msgId]) clearInterval(activeTimersRef.current[msgId]);
		const timer = setInterval(() => {
			const currentContent = streamFn(targetContent, index);
			index += 1;
			setAnimatedContents(prev => ({ ...prev, [msgId]: currentContent }));
			if (currentContent.length >= targetContent.length) {
				clearInterval(timer);
				delete activeTimersRef.current[msgId];
			}
		}, interval);
		activeTimersRef.current[msgId] = timer;
	};

	useEffect(() => {
		const lastMessage = messagesToDisplay?.at(-1);
		const prevLastMessage = prevMessagesRef.current?.at(-1);

		if (
			lastMessage?.role === 'assistant' &&
			lastMessage.content &&
			prevLastMessage &&
			lastMessage.id === prevLastMessage.id &&
			!prevLastMessage.content
		) {
			simulateTyping(lastMessage);
		}

		prevMessagesRef.current = messagesToDisplay;
	}, [messagesToDisplay]);

	useFirestoreCollectionListener({
		queryFn: () => {
			if (!ownerAddress || !activeConversationId || !db) {
				// Return a query that returns empty result
				return query(
					collection(db!, 'senseai_feedback'),
					where('__name__' as any, '==' as any, '__invalid__' as any),
				);
			}
			return query(
				collection(db, 'senseai_feedback'),
				where('ownerAddress' as any, '==' as any, ownerAddress as any),
				where('conversationId' as any, '==' as any, activeConversationId as any),
			);
		},
		queryDeps: [ownerAddress, activeConversationId],
		dataFn: (docs: any[]) => {
			const feedbackMap: Record<string, number> = {};
			docs.forEach((doc: any) => {
				feedbackMap[doc.id] = doc.feedbackValue;
			});
			setFeedbackData(feedbackMap);
		},
		deps: [ownerAddress, activeConversationId],
		loadingTag: 'SenseAIFeedbackListener',
	});

	// Derived state: Check if AI is thinking (assistant message with no content)
	const lastMessage = messagesToDisplay.at(-1);
	// A content-less assistant message is "thinking" ONLY while the prompt is still live.
	// The cancel/refund unblock is actually done by dropping the orphaned placeholder
	// (syncService.dropCancelledAnswerPlaceholders) + the isQueryAhead removal-reconcile
	// above. This status exclusion is a DEFENSIVE consistency guard mirroring
	// hasPendingAnswer/conversationHasPendingMessage: should an assistant message ever
	// carry a 'cancelled'/'refunded' status (a future or non-cancel path), it must not
	// read as "thinking". It is not what unsticks the current cancel flow — don't remove
	// the drop/reconcile layers on the assumption that this handles it.
	const isAiThinking =
		lastMessage?.role === 'assistant' &&
		!lastMessage.content &&
		lastMessage.status !== 'cancelled' &&
		lastMessage.status !== 'refunded';

	// Clear cancel deadline when answer arrives or thinking stops
	useEffect(() => {
		if (!isAiThinking) setCancelDeadline(null);
	}, [isAiThinking]);

	// Cancel countdown: disabled while the escrow would still refuse (createdAt + 3 s), enabled
	// once it accepts — see cancelWindow. The affordance is derived from (deadline, clock) during
	// render and openCancelWindow sets both in one batch, so the first paint after the receipt is
	// already "Cancel in 3s" (no enabled flash). Reads Date.now() on every tick for tab-background
	// safety and stops ticking once the window is open.
	useEffect(() => {
		if (cancelDeadline === null || cancelWindow(cancelDeadline, Date.now()).isCancellable) {
			return undefined;
		}
		const id = setInterval(() => {
			const now = Date.now();
			setCancelClock(now);
			if (cancelWindow(cancelDeadline, now).isCancellable) clearInterval(id);
		}, 200);
		return () => clearInterval(id);
	}, [cancelDeadline]);

	// From when the prompt was confirmed: now on success, the confirmation after a failed save.
	const openCancelWindow = (confirmedAt = Date.now()) => {
		setCancelClock(Date.now());
		setCancelDeadline(confirmedAt + CANCELLATION_TIMEOUT_MS);
	};

	// Refund eligibility countdown
	const submittedAt = lastMessage?.createdAt ?? null;
	useEffect(() => {
		if (!isAiThinking || submittedAt === null) {
			setRefundSecondsLeft(null);
			return undefined;
		}
		const tick = () => {
			setRefundSecondsLeft(secondsUntilRefund(submittedAt, Date.now()));
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [isAiThinking, submittedAt]);

	const handleCancelPrompt = () => {
		if (!sessionKey || !ownerAddress || !activeConversationId || !lastMessage?.id) return;

		cancelPromptMutation.mutate(
			{ answerMessageId: lastMessage.id },
			{
				onSuccess: async () => {
					setCancelDeadline(null);

					// Tombstone the cancelled answer so a not-yet-refreshed query can't re-hydrate
					// its orphaned placeholder back into Redux (see cancelledAnswerIdsRef).
					cancelledAnswerIdsRef.current.add(String(lastMessage.id));

					try {
						// 1. Clean up IndexedDB so it doesn't reappear on refresh
						await deleteMessageFromConversation(
							sessionKey,
							ownerAddress,
							activeConversationId,
							String(lastMessage.id ?? ''),
							queryClient,
						);
					} catch (error) {
						console.error('Failed to cleanup cancelled message from DB:', error);
					}

					// 2. Update Redux to reflect change immediately
					const newMessages = activeConversationMessages.filter(m => m.id !== lastMessage.id);
					dispatch(setActiveConversationMessages(newMessages));

					// This ensures the UI renders the previous history instead of looking for the deleted ID.
					const newLastMessage = newMessages.at(-1);
					if (newLastMessage?.id) {
						setActiveMessageId(newLastMessage.id);
					} else {
						setActiveMessageId(null); // Conversation is empty
					}
				},
			},
		);
	};

	const onSubmit = (data: { prompt: string }) => {
		if (!sessionKey) return;

		// The new prompt threads off the last message in view (a null parent would store every
		// follow-up with no parent, and the synced thread would split into a disjoint branch).
		// See promptParentFor for how the parent is found and when a branch holds the prompt.
		if (composer.kind !== 'ready') return;
		const { parentId, parentCID } = composer;

		// Whether this conversation already has a delivered (content-bearing) answer. If it
		// doesn't (e.g. its only prior prompt was cancelled), the conversation was never
		// confirmed on-chain (ConversationAdded fires only with the first answer's
		// conversationCID), so the resend must be flagged new — otherwise the answer never
		// indexes and the chat stays stuck "Thinking…". See buildInitiatePromptPayload.
		const conversationHasAnswer = activeConversationMessages.some(
			m => m.role === 'assistant' && m.content != null && m.content !== '',
		);

		// A save can finish after the send was given up on and the composer freed: what the user
		// typed since is theirs, so it is neither cleared nor left for the old send's conversation.
		// Only text counts: an emptied composer holds nothing of the user's to keep.
		const hasNewDraft = () => {
			const draft = getValues('prompt');
			return typeof draft === 'string' && draft.trim() !== '' && draft !== data.prompt;
		};

		initiatePromptMutation.mutate(
			{
				conversationId: activeConversationId ?? 0,
				promptText: data.prompt,
				sessionKey,
				parentId,
				parentCID,
				conversationHasAnswer,
				hasBranchOrigin,
			},
			{
				onSuccess: async newIds => {
					const {
						conversationId: onChainConversationId,
						promptMessageId,
						answerMessageId,
					} = newIds;

					if (!ownerAddress) throw noWalletAddressError();

					if (activeConversationId) {
						const parentMsgId = messagesToDisplay?.at(-1)?.id ?? 0;
						const { finalUserMessage, finalAiMessage } = await addMessageToConversation(
							sessionKey,
							ownerAddress,
							activeConversationId,
							String(parentMsgId),
							data.prompt,
							String(promptMessageId),
							String(answerMessageId),
							queryClient,
						);
						if (!isStillActive(activeConversationId)) return;
						dispatch(
							appendLiveMessages([
								finalUserMessage as unknown as ActiveMessage,
								finalAiMessage as unknown as ActiveMessage,
							]),
						);
					} else {
						const { newConversation, finalUserMessage, finalAiMessage } =
							await createNewConversation(
								sessionKey,
								ownerAddress,
								data.prompt,
								String(onChainConversationId),
								String(promptMessageId),
								String(answerMessageId),
								queryClient,
							);
						// The composer cannot be typed in while a send is under way, so a new draft means the
						// save was given up on first (`SAVE_GIVE_UP_MS`): the cancel window, a few seconds
						// from the confirmation, has long closed and is not opened here.
						if (!isStillActive(activeConversationId) || hasNewDraft()) return;
						dispatch(setActiveConversationId(newConversation.id));
						dispatch(
							setActiveConversationMessages([
								finalUserMessage as unknown as ActiveMessage,
								finalAiMessage as unknown as ActiveMessage,
							]),
						);
					}
					openCancelWindow();
					if (!hasNewDraft()) reset();
				},
				// Sent and paid for, not saved here: the composer is cleared so it is not sent again,
				// and the prompt is shown from its receipt, at the time it was confirmed, with the cancel
				// window open from then. Only in the conversation it was sent in: another one open now
				// keeps its own draft and shows nothing of it (the hold is registered for it all the same).
				onSaveFailed: (newIds, confirmedAt) => {
					if (!isStillActive(activeConversationId)) return;
					reset();
					showUnsavedPrompt(dispatch, {
						activeConversationId,
						// The parent the prompt was sent with: the list shown may have moved on by now.
						parentId,
						content: data.prompt,
						ids: newIds,
						at: confirmedAt,
						queryClient,
						ownerAddress,
					});
					openCancelWindow(confirmedAt);
				},
				// onError: () => {},
			},
		);
	};

	const isProcessing = isSubmitting || isSending;

	const hasValidationError = !!errors.prompt;
	const isDisabled =
		isProcessing ||
		isAiThinking ||
		!sessionKey ||
		isLoadingPlan ||
		!hasActivePlan ||
		composer.kind !== 'ready' ||
		unsavedSend.isComposerHeld ||
		arePromptsSwitchedOff;

	const isInputDisabled =
		isProcessing ||
		!sessionKey ||
		isLoadingPlan ||
		!hasActivePlan ||
		composer.kind !== 'ready' ||
		unsavedSend.isComposerHeld ||
		arePromptsSwitchedOff;

	// Calculate UI status for the submit button
	const submitStatus = (() => {
		if (hasValidationError) {
			return 'error';
		}

		// Show loader while sending
		if (isProcessing) {
			return 'submitted';
		}

		// Show Send icon
		return 'ready';
	})();

	return (
		<div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
			<div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<div className="size-2 rounded-full bg-green-500" />
						<span className="font-medium text-sm">SenseAI Agent</span>
					</div>
				</div>
				<Button variant="ghost" size="sm" onClick={handleReset} className="h-8 px-2">
					<RotateCcwIcon className="size-4" />
					<span className="ml-1">Reset Chat</span>
				</Button>
			</div>
			<StorageUnavailableBanner className="rounded-none border-x-0 border-t-0" />
			<Conversation className="flex-1">
				<ConversationContent className="space-y-4">
					{(isLoading || isFetching) && !messagesToDisplay.length && (
						<div className="flex items-center justify-center h-full">
							<Loader />
						</div>
					)}

					{!activeConversationId && !isLoading && !isProcessing && (
						<div className="flex h-full flex-col items-center justify-center text-center p-4">
							<img src={senseaiLogo} alt="SenseAI" className="size-24 mb-4" />
							<h2 className="text-xl font-semibold">Start a new conversation</h2>
							<p className="text-muted-foreground max-w-sm mx-auto">
								Type a message below to begin.
							</p>
						</div>
					)}

					{isProcessing && !activeConversationId && (
						<div className="flex items-center justify-center h-full">
							<Loader />
						</div>
					)}

					{messagesToDisplay.map(message => {
						if (message.id === editingMessageId) {
							return (
								<div key={message.id} className="space-y-3">
									<EditPromptInput
										originalContent={message.content ?? ''}
										onSave={handleSaveEdit}
										isSending={isProcessing}
										heldReason={unsavedSend.editHeldReason}
										onCancel={() => setEditingMessageId(null)}
									/>
								</div>
							);
						}

						const isAssistant = message.role === 'assistant';
						const isThinking = isAssistant && !message.content;

						if (isAssistant) {
							const msgIdStr = String(message.id ?? '');
							const animatedContent = animatedContents[msgIdStr];
							const isTyping =
								animatedContent != null && animatedContent.length < (message.content?.length ?? 0);
							const hasReasoning = message.reasoning && message.reasoning.length > 0;

							return (
								<div
									key={String(message.id ?? message.answerMessageId ?? '')}
									className="space-y-3"
								>
									<div className="ml-10">
										<Reasoning
											isStreaming={isThinking}
											defaultOpen={false}
											reasoningDuration={message.reasoningDuration}
											reasoningSteps={
												message.reasoning && Array.isArray(message.reasoning)
													? message.reasoning
													: undefined
											}
										>
											<ReasoningTrigger hidden={!hasReasoning} />
											<ReasoningContent
												hidden={!hasReasoning}
												reasoningSteps={
													message.reasoning && Array.isArray(message.reasoning)
														? message.reasoning
														: undefined
												}
												sources={
													message.sources && Array.isArray(message.sources)
														? message.sources
														: undefined
												}
											/>
										</Reasoning>
									</div>
									{!isThinking && (
										<>
											<Message from={message.role} className="items-start" status={message.status}>
												<MessageContent>
													<div className="prose inherit-color prose-sm dark:prose-invert max-w-none">
														<ReactMarkdown
															remarkPlugins={[remarkGfm, remarkBreaks]}
															components={markdownComponents}
														>
															{isTyping ? `${animatedContent}▍` : message.content}
														</ReactMarkdown>
													</div>
												</MessageContent>
												<MessageAvatar src={senseaiLogo} name="SenseAI" />
											</Message>
											<MessageActions
												message={message}
												versionInfo={versionInfo[msgIdStr]}
												onRegenerate={mode => handleRegenerate(message, mode)}
												onNavigate={handleNavigate}
												onBranch={() => handleBranch(message as unknown as ActiveMessage)}
												isSending={isProcessing}
												heldReason={unsavedSend.heldReasonFor(message.id)}
												initialFeedback={
													feedbackData[msgIdStr] ? String(feedbackData[msgIdStr]) : null
												}
											/>
										</>
									)}

									{message.id &&
										currentConversation?.branchedAtMessageId === message.id &&
										currentConversation?.branchedFromConversationId && (
											<BranchInfo
												originalConversationId={currentConversation.branchedFromConversationId}
												onNavigate={originalId => {
													dispatch(setActiveConversationId(originalId));
													navigate('/chat');
												}}
											/>
										)}
								</div>
							);
						}

						const msgIdStr = String(message.id ?? '');
						return (
							<div key={msgIdStr} className="group space-y-1">
								<Message from={message.role} className="items-start">
									<MessageContent>
										<div className="prose inherit-color prose-sm dark:prose-invert max-w-none">
											<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
												{message.content}
											</ReactMarkdown>
										</div>
									</MessageContent>
									<MessageAvatar address={ownerAddress ?? ''} name="ME" />
								</Message>
								<div className="opacity-0 group-hover:opacity-100 transition-opacity">
									<UserMessageActions
										message={message}
										versionInfo={versionInfo[msgIdStr]}
										heldReason={unsavedSend.editHeldReason}
										onEdit={() => setEditingMessageId(message.id ?? null)}
										onNavigate={handleNavigate}
									/>
								</div>

								{message.id &&
									currentConversation?.branchedAtMessageId === message.id &&
									currentConversation?.branchedFromConversationId && (
										<BranchInfo
											originalConversationId={currentConversation.branchedFromConversationId}
											onNavigate={originalId => {
												dispatch(setActiveConversationId(originalId));
												navigate('/chat');
											}}
										/>
									)}
							</div>
						);
					})}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="border-t p-4">
				{isLoadingPlan ? (
					<div className="flex h-24 items-center justify-center">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : hasActivePlan ? (
					<PromptInput onSubmit={handleSubmit(onSubmit)} errors={errors}>
						<PromptInputTextarea
							placeholder="Ask about market sentiment, on-chain data..."
							disabled={isDisabled}
							aria-describedby={composerHoldDescription({
								isHeldForBranchHistory,
								unsavedSendReason: unsavedSend.composerHoldReason,
							})}
							{...register('prompt')}
						/>
						<ComposerHoldNotices
							isHeldForBranchHistory={isHeldForBranchHistory}
							unsavedSendReason={unsavedSend.composerHoldReason}
						/>
						{isAiThinking && refundSecondsLeft !== null && (
							<div className="flex items-center justify-end px-3 py-1.5 text-xs text-muted-foreground">
								{refundSecondsLeft > 0 ? (
									<span>
										Refund eligible in {Math.floor(refundSecondsLeft / 60)}m{' '}
										{refundSecondsLeft % 60}s
									</span>
								) : (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() =>
											lastMessage?.id &&
											processRefundMutation.mutate({ answerMessageId: lastMessage.id })
										}
										disabled={processRefundMutation.isPending}
									>
										{processRefundMutation.isPending && (
											<Loader2 className="size-3 animate-spin mr-1" />
										)}
										Request refund
									</Button>
								)}
							</div>
						)}
						<PromptInputToolbar>
							<PromptInputButton disabled>
								<MicIcon size={16} />
								<span>Voice</span>
							</PromptInputButton>
							{isAiThinking ? (
								<PromptInputCancel
									onClick={handleCancelPrompt}
									isLoading={cancelPromptMutation.isPending}
									disabled={cancelPromptMutation.isPending || !cancelAffordance.isCancellable}
									size={cancelPromptMutation.isPending ? 'icon' : 'default'}
								>
									{cancelPromptMutation.isPending ? undefined : cancelAffordance.label}
								</PromptInputCancel>
							) : (
								<PromptInputSubmit disabled={!isValid || isInputDisabled} status={submitStatus} />
							)}
						</PromptInputToolbar>
					</PromptInput>
				) : (
					<ActivatePlanCTA />
				)}
			</div>
		</div>
	);
}
