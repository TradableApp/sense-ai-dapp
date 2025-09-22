import { useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MicIcon, MicOffIcon, RotateCcwIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { z } from 'zod';

import userAvatarPlaceholder from '@/assets/react.svg';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai/conversation';
import Loader from '@/components/ai/loader';
import { Message, MessageAvatar, MessageContent } from '@/components/ai/message';
import {
	PromptInput,
	PromptInputButton,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from '@/components/ai/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai/reasoning';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai/source';
import { Button } from '@/components/ui/button';
// --- FIX: Changed import to a default import ---
import useSpeechRecognition from '@/hooks/useSpeechRecognition';
import {
	addMessageToConversation,
	createNewConversation,
	fetchMessagesForConversation,
} from '@/lib/mockApi';
import senseaiLogo from '@/senseai-logo.svg';
import { clearActiveConversation, setActiveConversationId } from '@/store/chatSlice';

const STREAM_BY_WORD = true;

const promptSchema = z.object({
	prompt: z
		.string()
		.trim()
		.min(1, { message: 'Message cannot be empty.' })
		.max(5000, { message: 'Message must be 5000 characters or less.' }),
});

export default function Chat() {
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const activeConversationId = useSelector(state => state.chat.activeConversationId);
	const [animatedContents, setAnimatedContents] = useState({});
	const activeTimersRef = useRef({});
	const prevMessagesRef = useRef([]);

	const {
		register,
		handleSubmit,
		reset,
		setValue,
		watch,
		formState: { errors, isSubmitting, isValid },
	} = useForm({
		resolver: zodResolver(promptSchema),
		mode: 'onChange',
		defaultValues: { prompt: '' },
	});

	const { isListening, transcript, startListening, stopListening, isSupported } =
		useSpeechRecognition();
	const currentPrompt = watch('prompt');

	useEffect(() => {
		if (transcript) {
			setValue('prompt', transcript, { shouldValidate: true });
		}
	}, [transcript, setValue]);

	const { data: messages, isLoading } = useQuery({
		queryKey: ['messages', activeConversationId],
		queryFn: () => fetchMessagesForConversation(activeConversationId),
		enabled: !!activeConversationId,
		refetchInterval: 1000,
	});
	console.log('messages', messages);

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

		if (activeTimersRef.current[message.id]) {
			clearInterval(activeTimersRef.current[message.id]);
		}

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
		const lastMessage = messages?.at(-1);
		const prevLastMessage = prevMessagesRef.current?.at(-1);

		if (
			lastMessage?.role === 'assistant' &&
			lastMessage.content &&
			!prevLastMessage?.content &&
			lastMessage.id === prevLastMessage?.id
		) {
			simulateTyping(lastMessage);
		}

		prevMessagesRef.current = messages;
	}, [messages]);

	const onSubmit = data => {
		const lastMessage = messages?.at(-1);
		if (lastMessage?.role === 'assistant') {
			setAnimatedContents(prev => ({ ...prev, [lastMessage.id]: lastMessage.content }));
		}
		stopListening();

		const parentId = messages?.at(-1)?.id || null;
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
		stopListening();
	};

	const handleVoiceClick = () => {
		if (isListening) {
			stopListening();
		} else {
			setValue('prompt', currentPrompt, { shouldValidate: true });
			startListening();
		}
	};

	const isProcessing =
		isSubmitting || addMessageMutation.isPending || newConversationMutation.isPending;

	const messagesToDisplay = messages || [];
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
						const isAssistant = message.role === 'assistant';
						const isThinking = isAssistant && !message.content;
						const animatedContent = animatedContents[message.id];
						const isTyping =
							isAssistant &&
							animatedContent != null &&
							animatedContent.length < (message.content?.length ?? 0);

						return (
							<div key={message.id} className="space-y-3">
								<Message from={message.role} className="items-start">
									<MessageContent>
										{isThinking ? (
											<div className="flex items-center gap-2">
												<Loader size={14} />
												<span className="text-muted-foreground text-sm">Thinking...</span>
											</div>
										) : (
											<>
												{animatedContent ?? message.content}
												{isTyping && <span className="animate-pulse">▍</span>}
											</>
										)}
									</MessageContent>
									<MessageAvatar
										src={message.role === 'user' ? userAvatarPlaceholder : senseaiLogo}
										name={message.role === 'user' ? 'You' : 'SenseAI'}
									/>
								</Message>
								{message.reasoning && message.reasoning.length > 0 && (
									<div className="ml-10">
										<Reasoning isStreaming={isThinking} defaultOpen={false}>
											<ReasoningTrigger />
											<ReasoningContent>{message.reasoning}</ReasoningContent>
										</Reasoning>
									</div>
								)}
								{message.sources && message.sources.length > 0 && (
									<div className="ml-10">
										<Sources>
											<SourcesTrigger count={message.sources.length} />
											<SourcesContent>
												{message.sources.map(source => (
													<Source
														key={`${source.url}${source.title}`}
														href={source.url}
														title={source.title}
													/>
												))}
											</SourcesContent>
										</Sources>
									</div>
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
						disabled={isAiWorking || isListening}
						{...register('prompt')}
					/>
					<PromptInputToolbar>
						{isSupported && (
							<PromptInputButton
								onClick={handleVoiceClick}
								disabled={isAiWorking}
								className={isListening ? 'text-destructive' : ''}
							>
								{isListening ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
								<span>{isListening ? 'Stop' : 'Voice'}</span>
							</PromptInputButton>
						)}
						<PromptInputSubmit disabled={!isValid || isAiWorking} status={submitStatus} />
					</PromptInputToolbar>
					{hasValidationError && (
						<p className="text-xs text-destructive p-2">{errors.prompt.message}</p>
					)}
				</PromptInput>
			</div>
		</div>
	);
}
