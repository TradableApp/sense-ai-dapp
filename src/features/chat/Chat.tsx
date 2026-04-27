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
import { Button } from '@/components/ui/button';
import { db } from '@/config/firebase';
import { useSession } from '@/features/auth/SessionProvider';
import useChatMutations from '@/hooks/useChatMutations';
import useConversations from '@/hooks/useConversations';
import useFirestoreCollectionListener from '@/hooks/useFirestoreCollectionListener';
import useUsagePlan from '@/hooks/useUsagePlan';
import { CANCELLATION_TIMEOUT_MS, REFUND_TIMEOUT_MS } from '@/lib/constants';
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
import senseaiLogo from '@/senseai-logo.svg';
import {
	type ActiveMessage,
	appendLiveMessages,
	clearActiveConversation,
	setActiveConversationId,
	setActiveConversationMessages,
} from '@/store/chatSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

import ActivatePlanCTA from './ActivatePlanCTA';

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

/**
 * Compares the latest message in two message arrays to determine if the
 * query (from IndexedDB) is more up-to-date than the redux (in-memory) state.
 * @param {Array} reduxMessages The array from `activeConversationMessages`.
 * @param {Array} queryMessages The array from `messagesFromQuery`.
 * @returns {boolean} True if the query data is ahead.
 */
function isQueryAhead(reduxMessages: ActiveMessage[], queryMessages: ActiveMessage[]): boolean {
	if (!queryMessages || queryMessages.length === 0) {
		return false;
	}
	if (reduxMessages.length === 0) {
		return true;
	}
	const latestReduxMsg = reduxMessages.at(-1);
	const latestQueryMsg = queryMessages.at(-1);

	if (!latestReduxMsg || !latestQueryMsg) {
		return false;
	}

	// 1. Check if we have a newer message ID
	const queryId = latestQueryMsg.id ?? 0;
	const reduxId = latestReduxMsg.id ?? 0;
	if (queryId > reduxId) {
		return true;
	}

	// 2. If IDs are the same, check for data updates
	if (queryId === reduxId) {
		// Check for status change (e.g. 'pending' -> 'cancelled')
		if (latestQueryMsg.status !== latestReduxMsg.status) {
			return true;
		}

		// Check for reasoning updates (streaming)
		const queryReasoningLength = latestQueryMsg.reasoning?.length || 0;
		const reduxReasoningLength = latestReduxMsg.reasoning?.length || 0;
		if (queryReasoningLength > reduxReasoningLength) {
			return true;
		}

		// Check for content updates (streaming completion)
		if (latestQueryMsg.content && !latestReduxMsg.content) {
			return true;
		}
	}
	return false;
}

const STREAM_BY_WORD = true;
const promptSchema = z.object({
	// Any changes to schema must be updated in tokenized-ai-agent/oracle/src/payloadValidator.js
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(5000),
});

export default function Chat() {
	const dispatch = useAppDispatch();
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
	} = useChatMutations();

	const [animatedContents, setAnimatedContents] = useState<Record<string, string>>({});
	const activeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	const prevMessagesRef = useRef<ActiveMessage[]>([]);
	const [activeMessageId, setActiveMessageId] = useState<string | number | null>(null);
	const [editingMessageId, setEditingMessageId] = useState<string | number | null>(null);
	const prevMessageCountRef = useRef(0);
	const [feedbackData, setFeedbackData] = useState<Record<string, number>>({});
	const [cancelDeadline, setCancelDeadline] = useState<number | null>(null);
	const [cancelSecondsLeft, setCancelSecondsLeft] = useState(0);
	const [refundSecondsLeft, setRefundSecondsLeft] = useState<number | null>(null);

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting, isValid },
	} = useForm({
		resolver: zodResolver(promptSchema),
		mode: 'onChange',
		defaultValues: { prompt: '' },
	});

	const { data: conversations } = useConversations();
	const currentConversation = conversations?.find(c => c.id === activeConversationId);

	const { data: activeConversationMetadata } = useQuery({
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
			const shouldHydrate = isQueryAhead(
				activeConversationMessages,
				messagesFromQuery as unknown as ActiveMessage[],
			);

			if (shouldHydrate) {
				dispatch(setActiveConversationMessages(messagesFromQuery as unknown as ActiveMessage[]));
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

	useEffect(() => {
		setActiveMessageId(null);
		setEditingMessageId(null);
		prevMessageCountRef.current = 0;
		prevMessagesRef.current = [];
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
					if (!ownerAddress) return;
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
			},
			{
				onSuccess: async newIds => {
					if (!ownerAddress) return;
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
					dispatch(
						appendLiveMessages([
							finalUserMessage as unknown as ActiveMessage,
							finalAiMessage as unknown as ActiveMessage,
						]),
					);
					setEditingMessageId(null);
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
					if (!ownerAddress) return;
					await branchConversation(
						sessionKey,
						ownerAddress,
						activeConversationId,
						String(messageToBranchFrom.id ?? 0),
						newConversationId,
						queryClient,
					);

					// Navigate to the new branch immediately
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
	const isAiThinking = lastMessage?.role === 'assistant' && !lastMessage.content;

	// Clear cancel deadline when answer arrives or thinking stops
	useEffect(() => {
		if (!isAiThinking) setCancelDeadline(null);
	}, [isAiThinking]);

	// Cancel countdown: compares Date.now() against deadline for tab-background safety
	useEffect(() => {
		if (cancelDeadline === null) {
			setCancelSecondsLeft(0);
			return undefined;
		}
		const tick = () => {
			const remaining = Math.max(0, Math.ceil((cancelDeadline - Date.now()) / 1000));
			setCancelSecondsLeft(remaining);
			return remaining;
		};
		if (tick() === 0) return undefined;
		const id = setInterval(() => {
			if (tick() === 0) clearInterval(id);
		}, 200);
		return () => clearInterval(id);
	}, [cancelDeadline]);

	// Refund eligibility countdown
	const submittedAt = lastMessage?.createdAt ?? null;
	useEffect(() => {
		if (!isAiThinking || submittedAt === null) {
			setRefundSecondsLeft(null);
			return undefined;
		}
		const tick = () => {
			const remaining = Math.max(
				0,
				Math.ceil((submittedAt + REFUND_TIMEOUT_MS - Date.now()) / 1000),
			);
			setRefundSecondsLeft(remaining);
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

		const parentIdValue = messagesToDisplay?.at(-1)?.id ?? null;
		const parentId = typeof parentIdValue === 'number' ? parentIdValue : null;
		const parentCID = messagesToDisplay?.at(-1)?.messageCID ?? null;

		initiatePromptMutation.mutate(
			{
				conversationId: activeConversationId ?? 0,
				promptText: data.prompt,
				sessionKey,
				parentId,
				parentCID,
			},
			{
				onSuccess: async newIds => {
					const {
						conversationId: onChainConversationId,
						promptMessageId,
						answerMessageId,
					} = newIds;

					if (!ownerAddress) return;

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
						dispatch(setActiveConversationId(newConversation.id));
						dispatch(
							setActiveConversationMessages([
								finalUserMessage as unknown as ActiveMessage,
								finalAiMessage as unknown as ActiveMessage,
							]),
						);
					}
					setCancelDeadline(Date.now() + CANCELLATION_TIMEOUT_MS);
					reset();
				},
				// onError: () => {},
			},
		);
	};

	const isProcessing =
		isSubmitting ||
		initiatePromptMutation.isPending ||
		regenerateMutation.isPending ||
		branchConversationMutation.isPending;

	const hasValidationError = !!errors.prompt;
	const isDisabled = isProcessing || isAiThinking || !sessionKey || isLoadingPlan || !hasActivePlan;

	const isInputDisabled = isProcessing || !sessionKey || isLoadingPlan || !hasActivePlan;

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
													? (message.reasoning as any)
													: undefined
											}
										>
											<ReasoningTrigger hidden={!hasReasoning} />
											<ReasoningContent
												hidden={!hasReasoning}
												reasoningSteps={
													message.reasoning && Array.isArray(message.reasoning)
														? (message.reasoning as any)
														: undefined
												}
												sources={
													message.sources && Array.isArray(message.sources)
														? (message.sources as any)
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
							{...register('prompt')}
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
									disabled={cancelPromptMutation.isPending || cancelSecondsLeft === 0}
									size={cancelSecondsLeft > 0 ? 'default' : 'icon'}
								>
									{cancelSecondsLeft > 0 ? `Cancel (${cancelSecondsLeft}s)` : undefined}
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
