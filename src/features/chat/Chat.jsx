import { useEffect, useMemo, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MicIcon, RotateCcwIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ReactMarkdown from 'react-markdown';
import { useDispatch, useSelector } from 'react-redux';
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
import {
	addMessageToConversation,
	createNewConversation,
	editUserMessage,
	fetchMessagesForConversation,
	regenerateAssistantResponse,
} from '@/lib/mockApi';
import { cn } from '@/lib/utils';
import senseaiLogo from '@/senseai-logo.svg';
import { clearActiveConversation, setActiveConversationId } from '@/store/chatSlice';

const STREAM_BY_WORD = true;
const promptSchema = z.object({
	prompt: z.string().trim().min(1, { message: 'Message cannot be empty.' }).max(5000),
});

export default function Chat() {
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const activeConversationId = useSelector(state => state.chat.activeConversationId);
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

	const { data: allMessages, isLoading } = useQuery({
		queryKey: ['messages', activeConversationId],
		queryFn: () => fetchMessagesForConversation(activeConversationId),
		enabled: !!activeConversationId,
		refetchInterval: 1000,
	});

	const { messagesToDisplay, versionInfo } = useMemo(() => {
		if (!allMessages || allMessages.length === 0) {
			return { messagesToDisplay: [], versionInfo: {} };
		}
		const messageMap = new Map(allMessages.map(m => [m.id, m]));
		const parentToChildrenMap = allMessages.reduce((acc, msg) => {
			const parentKey = String(msg.parentId);
			if (!acc[parentKey]) {
				acc[parentKey] = [];
			}
			acc[parentKey].push(msg);
			return acc;
		}, {});
		const versions = {};
		Object.keys(parentToChildrenMap).forEach(parentId => {
			const children = parentToChildrenMap[parentId];
			if (children.length > 1) {
				const siblings = children.sort((a, b) => a.timestamp - b.timestamp);
				siblings.forEach((msg, index) => {
					versions[msg.id] = {
						siblings: siblings.map(s => s.id),
						currentIndex: index,
					};
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
		}
		return { messagesToDisplay: displayPath, versionInfo: versions };
	}, [allMessages, activeMessageId]);

	useEffect(() => {
		if (allMessages && allMessages.length > prevMessageCountRef.current) {
			setActiveMessageId(allMessages.at(-1).id);
		} else if (!activeMessageId && allMessages?.length) {
			setActiveMessageId(allMessages.at(-1).id);
		}
		prevMessageCountRef.current = allMessages?.length || 0;
	}, [activeMessageId, allMessages]);

	useEffect(
		() => () => {
			Object.values(activeTimersRef.current).forEach(clearInterval);
		},
		[],
	);

	const handleMutationSuccess = newConversation => {
		queryClient.invalidateQueries({ queryKey: ['conversations'] });
		if (newConversation) {
			dispatch(setActiveConversationId(newConversation.id));
		}
		queryClient.invalidateQueries({ queryKey: ['messages', activeConversationId] });
	};

	const newConversationMutation = useMutation({
		mutationFn: createNewConversation,
		onSuccess: handleMutationSuccess,
	});

	const addMessageMutation = useMutation({
		mutationFn: variables =>
			addMessageToConversation(variables.conversationId, variables.parentId, variables.content),
		onSuccess: () => handleMutationSuccess(null),
	});

	const regenerateMutation = useMutation({
		mutationFn: variables =>
			regenerateAssistantResponse(
				variables.conversationId,
				variables.parentId,
				variables.originalUserQuery,
				variables.regenerationMode,
			),
		onSuccess: () => handleMutationSuccess(null),
	});

	const editUserMessageMutation = useMutation({
		mutationFn: variables =>
			editUserMessage(variables.conversationId, variables.parentId, variables.newContent),
		onSuccess: () => {
			setEditingMessageId(null);
			handleMutationSuccess(null);
		},
	});

	const handleRegenerate = (aiMessageToRegenerate, mode = 'default') => {
		const userPrompt = allMessages.find(m => m.id === aiMessageToRegenerate.parentId);
		if (userPrompt) {
			regenerateMutation.mutate({
				conversationId: activeConversationId,
				parentId: userPrompt.id,
				originalUserQuery: userPrompt.content,
				regenerationMode: mode,
			});
		}
	};

	const handleSaveEdit = data => {
		const originalMessage = allMessages.find(m => m.id === editingMessageId);
		if (originalMessage) {
			editUserMessageMutation.mutate({
				conversationId: activeConversationId,
				parentId: originalMessage.parentId,
				newContent: data.content,
			});
		}
	};

	const handleNavigate = targetBranchRootId => {
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
			if (currentNode.timestamp > latestMessageInBranch.timestamp) {
				latestMessageInBranch = currentNode;
			}
			const children = parentToChildrenMap[String(currentNode.id)];
			if (children) {
				queue.push(...children);
			}
		}
		setActiveMessageId(latestMessageInBranch.id);
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
			!prevLastMessage?.content &&
			lastMessage.id === prevLastMessage?.id
		) {
			simulateTyping(lastMessage);
		}

		prevMessagesRef.current = messagesToDisplay;
	}, [messagesToDisplay]);

	const onSubmit = data => {
		const lastMessage = messagesToDisplay?.at(-1);
		if (lastMessage?.role === 'assistant') {
			setAnimatedContents(prev => ({ ...prev, [lastMessage.id]: lastMessage.content }));
		}
		const parentId = messagesToDisplay?.at(-1)?.id || null;
		if (activeConversationId) {
			addMessageMutation.mutate({
				conversationId: activeConversationId,
				parentId,
				content: data.prompt,
			});
		} else {
			newConversationMutation.mutate(data.prompt);
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
		editUserMessageMutation.isPending;

	const lastMessage = messagesToDisplay.at(-1);
	const isAiThinking = lastMessage?.role === 'assistant' && !lastMessage.content;
	const hasValidationError = !!errors.prompt;
	const isAiWorking = isProcessing || isAiThinking;

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
					{isLoading && !messagesToDisplay.length && (
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
								<div key={message.id} className="space-y-3">
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
													<div className="prose prose-sm dark:prose-invert max-w-none">
														<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
															{(animatedContent ?? message.content) + (isTyping ? '▍' : '')}
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
											/>
										</>
									)}
								</div>
							);
						}

						return (
							<div key={message.id} className="group space-y-1">
								<Message from={message.role} className="items-start">
									<MessageContent>
										<div
											className={cn(
												'prose prose-sm dark:prose-invert max-w-none',
												'text-primary-foreground-important',
											)}
										>
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
