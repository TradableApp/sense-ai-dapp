import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where } from 'firebase/firestore';
import { Loader2, MicIcon, RotateCcwIcon, Split } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';
import { useDispatch, useSelector } from 'react-redux';
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
	appendLiveMessages,
	clearActiveConversation,
	setActiveConversationId,
	setActiveConversationMessages,
} from '@/store/chatSlice';

import ActivatePlanCTA from './ActivatePlanCTA';

function MarkdownParagraph({ children }) {
	return <p className="inline">{children}</p>;
}
const markdownComponents = { p: MarkdownParagraph };

function BranchInfo({ originalConversationId, onNavigate }) {
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
function isQueryAhead(reduxMessages, queryMessages) {
	if (!queryMessages || queryMessages.length === 0) {
		return false;
	}
	if (reduxMessages.length === 0) {
		return true;
	}
	const latestReduxMsg = reduxMessages.at(-1);
	const latestQueryMsg = queryMessages.at(-1);

	// 1. Check if we have a newer message ID
	if (latestQueryMsg.id > latestReduxMsg.id) {
		return true;
	}

	// 2. If IDs are the same, check for data updates
	if (latestQueryMsg.id === latestReduxMsg.id) {
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
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { sessionKey, ownerAddress } = useSession();
	const { activeConversationId, activeConversationMessages } = useSelector(state => state.chat);

	const { data: plan, isLoading: isLoadingPlan } = useUsagePlan();
	const hasActivePlan = !!plan;

	const {
		initiatePromptMutation,
		regenerateMutation,
		branchConversationMutation,
		cancelPromptMutation,
	} = useChatMutations();

	const [animatedContents, setAnimatedContents] = useState({});
	const activeTimersRef = useRef({});
	const prevMessagesRef = useRef([]);
	const [activeMessageId, setActiveMessageId] = useState(null);
	const [editingMessageId, setEditingMessageId] = useState(null);
	const prevMessageCountRef = useRef(0);
	const [feedbackData, setFeedbackData] = useState({});

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
		queryFn: () => getConversation(sessionKey, ownerAddress, activeConversationId),
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
		queryKey: ['messages', activeConversationId, sessionKey, ownerAddress],
		queryFn: () => {
			if (!activeConversationId) return [];
			return getMessagesForConversation(sessionKey, ownerAddress, activeConversationId);
		},
		enabled: !!activeConversationId && !!sessionKey && !!ownerAddress,
		refetchOnWindowFocus: false,
		refetchOnMount: true,
	});

	useEffect(() => {
		if (!isFetching && isSuccess && messagesFromQuery) {
			const shouldHydrate = isQueryAhead(activeConversationMessages, messagesFromQuery);

			if (shouldHydrate) {
				console.log(
					'%c[Chat.jsx-Hydrate] IndexedDB is ahead of Redux. Hydrating state.',
					'color: green; font-weight: bold;',
				);
				dispatch(setActiveConversationMessages(messagesFromQuery));
			}
		}
	}, [isFetching, isSuccess, messagesFromQuery, activeConversationMessages, dispatch]);

	const { messagesToDisplay, versionInfo } = useMemo(() => {
		const allMessages = activeConversationMessages;

		if (!allMessages || allMessages.length === 0) {
			return { messagesToDisplay: [], versionInfo: {} };
		}

		const messageMap = new Map(allMessages.map(m => [m.id, m]));
		const parentToChildrenMap = allMessages.reduce((acc, msg) => {
			const parentKey = String(msg.parentId);
			if (!acc[parentKey]) acc[parentKey] = [];
			acc[parentKey].push(msg);
			return acc;
		}, {});

		const versions = {};
		Object.keys(parentToChildrenMap).forEach(parentId => {
			const children = parentToChildrenMap[parentId];
			if (children.length > 1) {
				const siblings = children.sort((a, b) => a.createdAt - b.createdAt);
				siblings.forEach((msg, index) => {
					versions[msg.id] = { siblings: siblings.map(s => s.id), currentIndex: index };
				});
			}
		});

		const displayPath = [];

		// If activeMessageId is set but doesn't exist in the map (e.g. it was just deleted),
		// fall back to the latest message in the list.
		let currentId = activeMessageId;
		if (!currentId || !messageMap.has(currentId)) {
			currentId = allMessages.at(-1)?.id;
		}

		// Trace path backwards
		while (currentId && messageMap.has(currentId)) {
			const message = messageMap.get(currentId);
			displayPath.unshift(message);
			currentId = message.parentId;
		}

		return { messagesToDisplay: displayPath, versionInfo: versions };
	}, [activeConversationMessages, activeMessageId]);

	useEffect(() => {
		setActiveMessageId(null);
		setEditingMessageId(null);
		prevMessageCountRef.current = 0;
		prevMessagesRef.current = [];
	}, [activeConversationId]);

	const handleReset = useCallback(() => {
		dispatch(clearActiveConversation());
		setAnimatedContents({});
		Object.values(activeTimersRef.current).forEach(clearInterval);
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
			setActiveMessageId(activeConversationMessages.at(-1).id);
		} else if (!activeMessageId && activeConversationMessages?.length) {
			setActiveMessageId(activeConversationMessages.at(-1).id);
		}
		prevMessageCountRef.current = activeConversationMessages?.length || 0;
	}, [activeMessageId, activeConversationMessages]);

	useEffect(() => () => Object.values(activeTimersRef.current).forEach(clearInterval), []);

	const handleRegenerate = (aiMessageToRegenerate, mode = 'default') => {
		const userPrompt = activeConversationMessages.find(
			m => m.id === aiMessageToRegenerate.parentId,
		);
		if (!userPrompt) return;

		// Map UI modes to natural language instructions
		const instructionMap = {
			default: 'better',
			detailed: 'more detailed',
			concise: 'more concise',
		};
		const instructions = instructionMap[mode] || 'better';

		regenerateMutation.mutate(
			{
				conversationId: activeConversationId,
				promptMessageId: userPrompt.id,
				originalAnswerMessageId: aiMessageToRegenerate.id,
				instructions,
				sessionKey,
				promptMessageCID: userPrompt.messageCID,
				originalAnswerMessageCID: aiMessageToRegenerate.messageCID,
			},
			{
				onSuccess: async ({ newAnswerMessageId }) => {
					const { finalAiMessage } = await regenerateAssistantResponse(
						sessionKey,
						ownerAddress,
						activeConversationId,
						userPrompt.id,
						userPrompt.content,
						mode,
						newAnswerMessageId,
						queryClient,
					);
					dispatch(appendLiveMessages([finalAiMessage]));
				},
				// onError: () => {},
			},
		);
	};

	const handleSaveEdit = data => {
		const originalMessage = activeConversationMessages.find(m => m.id === editingMessageId);
		if (!originalMessage) return;

		initiatePromptMutation.mutate(
			{
				conversationId: activeConversationId,
				promptText: data.content,
				sessionKey,
				parentId: originalMessage.parentId,
			},
			{
				onSuccess: async newIds => {
					const { finalUserMessage, finalAiMessage } = await editUserMessage(
						sessionKey,
						ownerAddress,
						activeConversationId,
						originalMessage.parentId,
						data.content,
						newIds.promptMessageId,
						newIds.answerMessageId,
						queryClient,
					);
					dispatch(appendLiveMessages([finalUserMessage, finalAiMessage]));
					setEditingMessageId(null);
				},
				// onError: () => {},
			},
		);
	};

	const handleNavigate = targetBranchRootId => {
		const allMessages = activeConversationMessages;
		if (!allMessages) return;
		const messageMap = new Map(allMessages.map(m => [m.id, m]));
		const parentToChildrenMap = allMessages.reduce((acc, msg) => {
			const parentKey = String(msg.parentId);
			if (!acc[parentKey]) acc[parentKey] = [];
			acc[parentKey].push(msg);
			return acc;
		}, {});
		let latestMessageInBranch = messageMap.get(targetBranchRootId);
		const queue = [latestMessageInBranch];
		while (queue.length > 0) {
			const [currentNode] = queue.splice(0, 1);
			if (currentNode.createdAt > latestMessageInBranch.createdAt) {
				latestMessageInBranch = currentNode;
			}
			const children = parentToChildrenMap[String(currentNode.id)];
			if (children) {
				queue.push(...children);
			}
		}
		setActiveMessageId(latestMessageInBranch.id);
	};

	const handleBranch = messageToBranchFrom => {
		const conversation = conversations.find(c => c.id === activeConversationId);
		if (!conversation) return;

		branchConversationMutation.mutate(
			{
				originalConversationId: activeConversationId,
				branchPointMessageId: messageToBranchFrom.id,
				originalTitle: conversation.title,
				sessionKey,
			},
			{
				onSuccess: async ({ newConversationId }) => {
					await branchConversation(
						sessionKey,
						ownerAddress,
						activeConversationId,
						messageToBranchFrom.id,
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

	const simulateTyping = message => {
		const targetContent = message.content;
		const streamFn = STREAM_BY_WORD
			? (content, i) =>
					content
						.split(' ')
						.slice(0, i + 1)
						.join(' ')
			: (content, i) => content.slice(0, i + 1);
		const interval = STREAM_BY_WORD ? 120 : 50;
		let index = 0;
		setAnimatedContents(prev => ({ ...prev, [message.id]: '' }));
		if (activeTimersRef.current[message.id]) clearInterval(activeTimersRef.current[message.id]);
		const timer = setInterval(() => {
			const currentContent = streamFn(targetContent, index);
			index += 1;
			setAnimatedContents(prev => ({ ...prev, [message.id]: currentContent }));
			if (currentContent.length >= targetContent.length) {
				clearInterval(timer);
				delete activeTimersRef.current[message.id];
			}
		}, interval);
		activeTimersRef.current[message.id] = timer;
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
		queryFn:
			ownerAddress &&
			activeConversationId &&
			(() =>
				query(
					collection(db, 'senseai_feedback'),
					where('ownerAddress', '==', ownerAddress),
					where('conversationId', '==', activeConversationId),
				)),
		queryDeps: [ownerAddress, activeConversationId],
		dataFn: docs => {
			const feedbackMap = {};
			docs.forEach(doc => {
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

	const handleCancelPrompt = () => {
		if (lastMessage?.id) {
			cancelPromptMutation.mutate(
				{ answerMessageId: lastMessage.id },
				{
					onSuccess: async () => {
						try {
							// 1. Clean up IndexedDB so it doesn't reappear on refresh
							await deleteMessageFromConversation(
								sessionKey,
								ownerAddress,
								activeConversationId,
								lastMessage.id,
								queryClient,
							);
						} catch (error) {
							console.error('Failed to cleanup cancelled message from DB:', error);
						}

						// 2. Update Redux to reflect change immediately
						const newMessages = activeConversationMessages.filter(m => m.id !== lastMessage.id);
						console.log('newMessages', newMessages);
						dispatch(setActiveConversationMessages(newMessages));

						// This ensures the UI renders the previous history instead of looking for the deleted ID.
						const newLastMessage = newMessages.at(-1);
						if (newLastMessage) {
							setActiveMessageId(newLastMessage.id);
						} else {
							setActiveMessageId(null); // Conversation is empty
						}
					},
				},
			);
		}
	};

	const onSubmit = data => {
		initiatePromptMutation.mutate(
			{
				conversationId: activeConversationId,
				promptText: data.prompt,
				sessionKey,
				parentId: messagesToDisplay?.at(-1)?.id,
			},
			{
				onSuccess: async newIds => {
					const {
						conversationId: onChainConversationId,
						promptMessageId,
						answerMessageId,
					} = newIds;

					if (activeConversationId) {
						const { finalUserMessage, finalAiMessage } = await addMessageToConversation(
							sessionKey,
							ownerAddress,
							activeConversationId,
							messagesToDisplay?.at(-1)?.id,
							data.prompt,
							promptMessageId,
							answerMessageId,
							queryClient,
						);
						dispatch(appendLiveMessages([finalUserMessage, finalAiMessage]));
					} else {
						const { newConversation, finalUserMessage, finalAiMessage } =
							await createNewConversation(
								sessionKey,
								ownerAddress,
								data.prompt,
								onChainConversationId,
								promptMessageId,
								answerMessageId,
								queryClient,
							);
						dispatch(setActiveConversationId(newConversation.id));
						dispatch(setActiveConversationMessages([finalUserMessage, finalAiMessage]));
					}
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
										originalContent={message.content}
										onSave={handleSaveEdit}
										onCancel={() => setEditingMessageId(null)}
									/>
								</div>
							);
						}

						const isAssistant = message.role === 'assistant';
						const isThinking = isAssistant && !message.content;

						if (isAssistant) {
							const animatedContent = animatedContents[message.id];
							const isTyping =
								animatedContent != null && animatedContent.length < (message.content?.length ?? 0);
							const hasReasoning = message.reasoning && message.reasoning.length > 0;

							return (
								<div key={message.id || message.answerMessageId} className="space-y-3">
									<div className="ml-10">
										<Reasoning
											isStreaming={isThinking}
											defaultOpen={false}
											reasoningDuration={message.reasoningDuration}
											reasoningSteps={message.reasoning}
										>
											<ReasoningTrigger hidden={!hasReasoning} />
											<ReasoningContent
												hidden={!hasReasoning}
												reasoningSteps={message.reasoning}
												sources={message.sources}
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
												versionInfo={versionInfo[message.id]}
												onRegenerate={mode => handleRegenerate(message, mode)}
												onNavigate={handleNavigate}
												onBranch={() => handleBranch(message)}
												initialFeedback={feedbackData[message.id] || null}
											/>
										</>
									)}

									{message.id === currentConversation?.branchedAtMessageId && (
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

						return (
							<div key={message.id} className="group space-y-1">
								<Message from={message.role} className="items-start">
									<MessageContent>
										<div className="prose inherit-color prose-sm dark:prose-invert max-w-none">
											<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
												{message.content}
											</ReactMarkdown>
										</div>
									</MessageContent>
									<MessageAvatar address={ownerAddress} name="ME" />
								</Message>
								<div className="opacity-0 group-hover:opacity-100 transition-opacity">
									<UserMessageActions
										message={message}
										versionInfo={versionInfo[message.id]}
										onEdit={() => setEditingMessageId(message.id)}
										onNavigate={handleNavigate}
									/>
								</div>

								{message.id === currentConversation?.branchedAtMessageId && (
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
						<PromptInputToolbar>
							<PromptInputButton disabled>
								<MicIcon size={16} />
								<span>Voice</span>
							</PromptInputButton>
							{isAiThinking ? (
								<PromptInputCancel
									onClick={handleCancelPrompt}
									isLoading={cancelPromptMutation.isPending}
								/>
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
