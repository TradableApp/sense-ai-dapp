import { useCallback, useState } from 'react';

import cuid from 'cuid';
import { RotateCcwIcon, Send } from 'lucide-react'; // Import Send icon

// AI Components from our project structure
import userAvatarPlaceholder from '@/assets/react.svg'; // Placeholder for user
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai/conversation';
import Loader from '@/components/ai/loader';
import { Message, MessageAvatar, MessageContent } from '@/components/ai/message';
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from '@/components/ai/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai/reasoning';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai/source';
import { Button } from '@/components/ui/button';
import senseaiLogo from '@/senseai-logo.svg';

// --- Configuration for Streaming ---
// Set to true for word-by-word streaming, false for character-by-character.
const STREAM_BY_WORD = true;

const sampleResponses = [
	{
		content:
			'The current sentiment for Bitcoin is cautiously optimistic. We are seeing positive momentum in several key on-chain metrics and increased social media volume.',
		reasoning:
			'To determine sentiment, I analyzed the Fear & Greed Index, recent whale transaction volumes from Glassnode, and the linguistic tone of the top 50 crypto influencers on X (formerly Twitter). The data points towards accumulation.',
		sources: [
			{
				title: 'Alternative.me: Fear & Greed Index',
				url: 'https://alternative.me/crypto/fear-and-greed-index/',
			},
			{ title: 'Glassnode: On-Chain Metrics', url: 'https://glassnode.com' },
		],
	},
	{
		content:
			"An upcoming significant event for Ethereum is the EIP-7702 proposal, which aims to improve account abstraction. This could reduce transaction costs for users and is scheduled for the next major network upgrade, 'Pectra'.",
		reasoning:
			'This information is sourced from the official Ethereum Improvement Proposal repository and recent developer consensus call notes. The community sentiment around this proposal is largely positive.',
		sources: [{ title: 'EIP-7702 Proposal Details', url: 'https://eip7702.com' }],
	},
];

const INITIAL_MESSAGE = {
	id: cuid(),
	// 3. Customize the initial greeting
	content:
		'Hello! I am SenseAI. Ask me about crypto market sentiment, upcoming fundamental events, or on-chain data analysis.',
	role: 'assistant',
	timestamp: new Date(),
	sources: [
		{ title: 'Learn about SenseAI', url: '#' },
		{ title: 'View Market Pulse', url: '/' },
	],
};

export default function Chat() {
	const [messages, setMessages] = useState([INITIAL_MESSAGE]);
	const [inputValue, setInputValue] = useState('');
	const [isTyping, setIsTyping] = useState(false);

	const simulateTyping = useCallback((messageId, content, reasoning, sources) => {
		if (STREAM_BY_WORD) {
			// Word-by-word streaming
			const words = content.split(' ');
			let currentWordIndex = 0;
			const typeInterval = setInterval(() => {
				setMessages(prev =>
					prev.map(msg => {
						if (msg.id === messageId) {
							const currentContent = words.slice(0, currentWordIndex).join(' ');
							const isFinished = currentWordIndex >= words.length;
							return {
								...msg,
								content: currentContent,
								isStreaming: !isFinished,
								reasoning: isFinished ? reasoning : undefined,
								sources: isFinished ? sources : undefined,
							};
						}
						return msg;
					}),
				);

				currentWordIndex += 1;

				if (currentWordIndex > words.length) {
					clearInterval(typeInterval);
					setIsTyping(false);
				}
			}, 120); // Slower interval for words
			return () => clearInterval(typeInterval);
		}

		// Character-by-character streaming (original logic)
		let currentIndex = 0;
		const typeInterval = setInterval(() => {
			setMessages(prev =>
				prev.map(msg => {
					if (msg.id === messageId) {
						const currentContent = content.slice(0, currentIndex);
						const isFinished = currentIndex >= content.length;
						return {
							...msg,
							content: currentContent,
							isStreaming: !isFinished,
							reasoning: isFinished ? reasoning : undefined,
							sources: isFinished ? sources : undefined,
						};
					}
					return msg;
				}),
			);
			currentIndex += Math.random() > 0.1 ? 1 : 0; // Simulate organic typing

			if (currentIndex >= content.length) {
				clearInterval(typeInterval);
				setIsTyping(false);
			}
		}, 50);
		return () => clearInterval(typeInterval);
	}, []);

	const handleSubmit = useCallback(
		event => {
			event.preventDefault();
			if (!inputValue.trim() || isTyping) return;

			const userMessage = {
				id: cuid(),
				content: inputValue.trim(),
				role: 'user',
				timestamp: new Date(),
			};
			setMessages(prev => [...prev, userMessage]);
			setInputValue('');
			setIsTyping(true);

			setTimeout(() => {
				const responseData = sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
				const assistantMessageId = cuid();
				const assistantMessage = {
					id: assistantMessageId,
					content: '',
					role: 'assistant',
					timestamp: new Date(),
					isStreaming: true,
				};
				setMessages(prev => [...prev, assistantMessage]);
				simulateTyping(
					assistantMessageId,
					responseData.content,
					responseData.reasoning,
					responseData.sources,
				);
			}, 800);
		},
		[inputValue, isTyping, simulateTyping],
	);

	const handleReset = useCallback(() => {
		setMessages([INITIAL_MESSAGE]);
		setInputValue('');
		setIsTyping(false);
	}, []);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-primary-foreground shadow-sm">
			{/* Header */}
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

			{/* Conversation Area */}
			<Conversation className="flex-1">
				<ConversationContent className="space-y-4">
					{messages.map(message => (
						<div key={message.id} className="space-y-3">
							<Message from={message.role} className="items-start">
								<MessageContent>
									{message.isStreaming && message.content === '' ? (
										<div className="flex items-center gap-2">
											<Loader size={14} />
											<span className="text-muted-foreground text-sm">Thinking...</span>
										</div>
									) : (
										message.content
									)}
								</MessageContent>
								<MessageAvatar
									src={message.role === 'user' ? userAvatarPlaceholder : senseaiLogo}
									name={message.role === 'user' ? 'You' : 'SenseAI'}
								/>
							</Message>
							{message.reasoning && (
								<div className="ml-10">
									<Reasoning isStreaming={message.isStreaming} defaultOpen={false}>
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
											{message.sources.map((source, index) => (
												<Source key={index} href={source.url} title={source.title} />
											))}
										</SourcesContent>
									</Sources>
								</div>
							)}
						</div>
					))}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			{/* Input Area */}
			<div className="border-t p-4">
				<PromptInput onSubmit={handleSubmit}>
					<PromptInputTextarea
						value={inputValue}
						onChange={e => setInputValue(e.target.value)}
						// 5. Customize placeholder text
						placeholder="Ask about market sentiment, on-chain data..."
						disabled={isTyping}
					/>
					<PromptInputToolbar>
						{/* 6. Simplified toolbar - submit button only */}
						<PromptInputSubmit
							disabled={!inputValue.trim() || isTyping}
							status={isTyping ? 'streaming' : 'ready'}
						>
							<Send />
						</PromptInputSubmit>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}
