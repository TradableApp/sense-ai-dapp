import { useEffect, useMemo, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MicIcon, RotateCcwIcon, Split } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';

import userAvatarPlaceholder from '@/assets/react.svg';
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
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from '@/components/ai/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai/reasoning';
import UserMessageActions from '@/components/ai/user-message-actions';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/SessionProvider';
import useConversations from '@/hooks/useConversations';
import {
	addMessageToConversation,
	branchConversation,
	createNewConversation,
	editUserMessage,
	getMessagesForConversation,
	regenerateAssistantResponse,
} from '@/lib/dataService';
import senseaiLogo from '@/senseai-logo.svg';
import {
	addReasoningStepByCorrelationId,
	appendLiveMessages,
	clearActiveConversation,
	setActiveConversationId,
	setActiveConversationMessages,
	updateMessageContentByCorrelationId,
} from '@/store/chatSlice';

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

const STREAM_BY_WORD = true;
const promptSchema = z.object({
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(5000),
});

export default function Chat() {
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { sessionKey, ownerAddress } = useSession();
	const { activeConversationId, activeConversationMessages } = useSelector(state => state.chat);

	console.log(
		'[Chat.jsx] Component Render. State:',
		`\n  - activeConversationId: ${activeConversationId}`,
		`\n  - activeConversationMessages count: ${activeConversationMessages.length}`,
	);

	const [animatedContents, setAnimatedContents] = useState({});
	const activeTimersRef = useRef({});
	const prevMessagesRef = useRef([]);
	const [activeMessageId, setActiveMessageId] = useState(null);
	const [editingMessageId, setEditingMessageId] = useState(null);
	const prevMessageCountRef = useRef(0);

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

	const { data: queryData, isLoading } = useQuery({
		queryKey: ['messages', activeConversationId, sessionKey, ownerAddress],
		queryFn: () => {
			console.log(
				`%c[useQuery messages] queryFn TRIGGERED for conversation: ${activeConversationId}`,
				'color: blue; font-weight: bold;',
			);
			return getMessagesForConversation(sessionKey, ownerAddress, activeConversationId);
		},
		onSuccess: messages => {
			console.log(
				`%c[useQuery messages] onSuccess FIRED. Fetched ${
					messages?.length || 0
				} messages. Populating Redux.`,
				'color: green; font-weight: bold;',
			);
			if (messages) {
				dispatch(setActiveConversationMessages(messages));
			}
		},
		enabled: !!activeConversationId && !!sessionKey && !!ownerAddress,
	});

	console.log(
		'[useQuery messages] Status:',
		`\n  - isLoading: ${isLoading}`,
		`\n  - queryData count: ${queryData?.length || 0}`,
	);

	const { messagesToDisplay, versionInfo } = useMemo(() => {
		const allMessages = activeConversationMessages;
		console.log(
			`[useMemo messagesToDisplay] Calculating... using ${allMessages.length} messages from Redux.`,
		);
		if (!allMessages || allMessages.length === 0) return { messagesToDisplay: [], versionInfo: {} };
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
		if (activeMessageId) {
			let currentId = activeMessageId;
			while (currentId && messageMap.has(currentId)) {
				const message = messageMap.get(currentId);
				displayPath.unshift(message);
				currentId = message.parentId;
			}
		} else if (allMessages.length > 0) {
			const latestMessage = allMessages.at(-1);
			let currentId = latestMessage.id;
			while (currentId && messageMap.has(currentId)) {
				const message = messageMap.get(currentId);
				displayPath.unshift(message);
				currentId = message.parentId;
			}
		}
		console.log(
			`[useMemo messagesToDisplay] Calculation complete. Returning ${displayPath.length} messages to render.`,
		);
		return { messagesToDisplay: displayPath, versionInfo: versions };
	}, [activeConversationMessages, activeMessageId]);

	useEffect(() => {
		console.log('[useEffect] activeConversationId changed. Resetting local state.');
		setActiveMessageId(null);
		setEditingMessageId(null);
		prevMessageCountRef.current = 0;
		prevMessagesRef.current = [];
	}, [activeConversationId]);

	useEffect(() => {
		if (
			activeConversationMessages &&
			activeConversationMessages.length > prevMessageCountRef.current
		) {
			console.log('[useEffect] New messages detected. Setting activeMessageId.');
			setActiveMessageId(activeConversationMessages.at(-1).id);
		} else if (!activeMessageId && activeConversationMessages?.length) {
			console.log('[useEffect] No active message. Setting to last message in list.');
			setActiveMessageId(activeConversationMessages.at(-1).id);
		}
		prevMessageCountRef.current = activeConversationMessages?.length || 0;
	}, [activeMessageId, activeConversationMessages]);

	useEffect(() => () => Object.values(activeTimersRef.current).forEach(clearInterval), []);

	const handleMutationError = error => {
		console.error('On-chain transaction simulation failed:', error);
	};

	const newConversationMutation = useMutation({
		mutationFn: variables =>
			createNewConversation(
				sessionKey,
				ownerAddress,
				variables.content,
				variables.aiCorrelationId,
				variables.onReasoningStep,
				variables.onFinalAnswer,
			),
		onSuccess: ({ newConversation, finalUserMessage, finalAiMessage }, variables) => {
			const queryKey = ['conversations', sessionKey, ownerAddress];
			console.log(`[Chat.jsx] New conversation created: ${newConversation.id}.`);
			queryClient.setQueryData(queryKey, (oldData = []) =>
				[newConversation, ...oldData].sort(
					(a, b) => (b.lastMessageCreatedAt || 0) - (a.lastMessageCreatedAt || 0),
				),
			);
			dispatch(setActiveConversationId(newConversation.id));
			const aiMessagePlaceholder = {
				...finalAiMessage,
				correlationId: variables.aiCorrelationId,
				reasoning: [],
			};
			dispatch(setActiveConversationMessages([finalUserMessage, aiMessagePlaceholder]));
		},
		onError: handleMutationError,
	});

	const addMessageMutation = useMutation({
		mutationFn: variables =>
			addMessageToConversation(
				sessionKey,
				ownerAddress,
				variables.conversationId,
				variables.parentId,
				variables.content,
				variables.aiCorrelationId,
				variables.onReasoningStep,
				variables.onFinalAnswer,
			),
		onSuccess: ({ updatedConversation, finalUserMessage, finalAiMessage }, variables) => {
			const queryKey = ['conversations', sessionKey, ownerAddress];
			console.log(`[Chat.jsx] Conversation ${updatedConversation.id} updated.`);
			queryClient.setQueryData(queryKey, (oldData = []) =>
				oldData
					.map(conv => (conv.id === updatedConversation.id ? updatedConversation : conv))
					.sort((a, b) => (b.lastMessageCreatedAt || 0) - (a.lastMessageCreatedAt || 0)),
			);
			const aiMessagePlaceholder = {
				...finalAiMessage,
				correlationId: variables.aiCorrelationId,
				reasoning: [],
			};
			dispatch(appendLiveMessages([finalUserMessage, aiMessagePlaceholder]));
		},
		onError: handleMutationError,
	});

	const regenerateMutation = useMutation({
		mutationFn: variables =>
			regenerateAssistantResponse(
				sessionKey,
				ownerAddress,
				variables.conversationId,
				variables.parentId,
				variables.originalUserQuery,
				variables.regenerationMode,
				variables.aiCorrelationId,
				variables.onReasoningStep,
				variables.onFinalAnswer,
			),
		onSuccess: ({ updatedConversation, finalAiMessage }, variables) => {
			const queryKey = ['conversations', sessionKey, ownerAddress];
			console.log(`[Chat.jsx] Regeneration successful for conv ${updatedConversation.id}.`);
			queryClient.setQueryData(queryKey, (oldData = []) =>
				oldData
					.map(conv => (conv.id === updatedConversation.id ? updatedConversation : conv))
					.sort((a, b) => (b.lastMessageCreatedAt || 0) - (a.lastMessageCreatedAt || 0)),
			);
			const aiMessagePlaceholder = {
				...finalAiMessage,
				correlationId: variables.aiCorrelationId,
				reasoning: [],
			};
			dispatch(appendLiveMessages([aiMessagePlaceholder]));
		},
		onError: handleMutationError,
	});

	const editUserMessageMutation = useMutation({
		mutationFn: variables =>
			editUserMessage(
				sessionKey,
				ownerAddress,
				variables.conversationId,
				variables.parentId,
				variables.newContent,
				variables.aiCorrelationId,
				variables.onReasoningStep,
				variables.onFinalAnswer,
			),
		onSuccess: ({ updatedConversation, finalUserMessage, finalAiMessage }, variables) => {
			setEditingMessageId(null);
			const queryKey = ['conversations', sessionKey, ownerAddress];
			console.log(`[Chat.jsx] Edit successful for conv ${updatedConversation.id}.`);
			queryClient.setQueryData(queryKey, (oldData = []) =>
				oldData
					.map(conv => (conv.id === updatedConversation.id ? updatedConversation : conv))
					.sort((a, b) => (b.lastMessageCreatedAt || 0) - (a.lastMessageCreatedAt || 0)),
			);
			const aiMessagePlaceholder = {
				...finalAiMessage,
				correlationId: variables.aiCorrelationId,
				reasoning: [],
			};
			dispatch(appendLiveMessages([finalUserMessage, aiMessagePlaceholder]));
		},
		onError: handleMutationError,
	});

	const branchConversationMutation = useMutation({
		mutationFn: variables =>
			branchConversation(
				sessionKey,
				ownerAddress,
				variables.originalConversationId,
				variables.branchPointMessageId,
			),
		onSuccess: newConversation => {
			if (newConversation) {
				queryClient.invalidateQueries({ queryKey: ['conversations', sessionKey, ownerAddress] });
				dispatch(setActiveConversationId(newConversation.id));
				navigate('/chat');
			}
		},
	});

	const handleRegenerate = (aiMessageToRegenerate, mode = 'default') => {
		const userPrompt = activeConversationMessages.find(
			m => m.id === aiMessageToRegenerate.parentId,
		);
		if (userPrompt) {
			const aiCorrelationId = Date.now().toString();
			console.log(
				`[Chat.jsx] Regenerating response for user message "${userPrompt.id}" with new aiCorrelationId "${aiCorrelationId}"`,
			);
			regenerateMutation.mutate({
				conversationId: activeConversationId,
				parentId: userPrompt.id,
				originalUserQuery: userPrompt.content,
				regenerationMode: mode,
				aiCorrelationId,
				onReasoningStep: (correlationId, reasoningStep) => {
					dispatch(addReasoningStepByCorrelationId({ correlationId, reasoningStep }));
				},
				onFinalAnswer: (correlationId, finalAnswer) => {
					dispatch(updateMessageContentByCorrelationId({ correlationId, ...finalAnswer }));
				},
			});
		}
	};

	const handleSaveEdit = data => {
		const originalMessage = activeConversationMessages.find(m => m.id === editingMessageId);
		if (originalMessage) {
			const aiCorrelationId = Date.now().toString();
			editUserMessageMutation.mutate({
				conversationId: activeConversationId,
				parentId: originalMessage.parentId,
				newContent: data.content,
				aiCorrelationId,
				onReasoningStep: (correlationId, reasoningStep) => {
					dispatch(addReasoningStepByCorrelationId({ correlationId, reasoningStep }));
				},
				onFinalAnswer: (correlationId, finalAnswer) => {
					dispatch(updateMessageContentByCorrelationId({ correlationId, ...finalAnswer }));
				},
			});
		}
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
		branchConversationMutation.mutate({
			originalConversationId: activeConversationId,
			branchPointMessageId: messageToBranchFrom.id,
		});
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

	const onSubmit = data => {
		console.log('[Chat.jsx] onSubmit called.');
		const parentId = messagesToDisplay?.at(-1)?.id || null;
		const aiCorrelationId = Date.now().toString();

		const onReasoningStep = (correlationId, reasoningStep) => {
			dispatch(addReasoningStepByCorrelationId({ correlationId, reasoningStep }));
		};
		const onFinalAnswer = (correlationId, finalAnswer) => {
			dispatch(updateMessageContentByCorrelationId({ correlationId, ...finalAnswer }));
		};

		if (activeConversationId) {
			addMessageMutation.mutate({
				conversationId: activeConversationId,
				parentId,
				content: data.prompt,
				aiCorrelationId,
				onReasoningStep,
				onFinalAnswer,
			});
		} else {
			newConversationMutation.mutate({
				content: data.prompt,
				aiCorrelationId,
				onReasoningStep,
				onFinalAnswer,
			});
		}
		reset();
	};

	const handleReset = () => {
		dispatch(clearActiveConversation());
		setAnimatedContents({});
		Object.values(activeTimersRef.current).forEach(clearInterval);
		activeTimersRef.current = {};
		prevMessagesRef.current = [];
		setActiveMessageId(null);
		prevMessageCountRef.current = 0;
	};

	const isProcessing =
		isSubmitting ||
		addMessageMutation.isPending ||
		newConversationMutation.isPending ||
		regenerateMutation.isPending ||
		editUserMessageMutation.isPending ||
		branchConversationMutation.isPending;

	const lastMessage = messagesToDisplay.at(-1);
	const isAiThinking = lastMessage?.role === 'assistant' && !lastMessage.content;
	const hasValidationError = !!errors.prompt;
	const isAiWorking = isProcessing || isAiThinking || !sessionKey;

	const submitStatus = (() => {
		if (hasValidationError) return 'error';
		if (isAiThinking) return 'streaming';
		if (isProcessing) return 'submitted';
		return 'ready';
	})();

	return (
		<div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-primary-foreground shadow-sm">
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
					{isLoading && !messagesToDisplay.length && !isProcessing && (
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
							return (
								<div key={message.id || message.correlationId} className="space-y-3">
									<div className="ml-10">
										<Reasoning
											isStreaming={isThinking}
											defaultOpen={false}
											reasoningDuration={message.reasoningDuration}
											reasoningSteps={message.reasoning}
										>
											<ReasoningTrigger />
											<ReasoningContent
												reasoningSteps={message.reasoning}
												sources={message.sources}
											/>
										</Reasoning>
									</div>
									{!isThinking && (
										<>
											<Message from={message.role} className="items-start">
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
									<MessageAvatar src={userAvatarPlaceholder} name="You" />
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
				<PromptInput onSubmit={handleSubmit(onSubmit)} errors={errors}>
					<PromptInputTextarea
						placeholder="Ask about market sentiment, on-chain data..."
						disabled={isAiWorking}
						{...register('prompt')}
					/>
					<PromptInputToolbar>
						<PromptInputButton disabled={!isValid || isAiWorking}>
							<MicIcon size={16} />
							<span>Voice</span>
						</PromptInputButton>
						<PromptInputSubmit disabled={!isValid || isAiWorking} status={submitStatus} />
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}
