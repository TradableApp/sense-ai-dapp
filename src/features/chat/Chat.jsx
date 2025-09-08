import { useEffect, useRef, useState } from 'react';

import cuid from 'cuid';

import { ScrollArea } from '@/components/ui/scroll-area';

import ChatInput from './components/ChatInput';
import MessageBubble from './components/MessageBubble';

const MOCK_MESSAGES = [
	{
		id: cuid(),
		role: 'assistant',
		content: 'Hello! I am SenseAI. How can I help you analyze the crypto market today?',
	},
];

export default function Chat() {
	const [messages, setMessages] = useState(MOCK_MESSAGES);
	const [inputValue, setInputValue] = useState('');
	const scrollAreaRef = useRef(null);
	useEffect(() => {
		if (scrollAreaRef.current) {
			const viewport = scrollAreaRef.current.querySelector('div');
			if (viewport) {
				viewport.scrollTop = viewport.scrollHeight;
			}
		}
	}, [messages]);

	const handleSendMessage = () => {
		if (!inputValue.trim()) return;

		const userMessage = { id: cuid(), role: 'user', content: inputValue };
		setMessages(prev => [...prev, userMessage]);
		setInputValue('');

		setTimeout(() => {
			const aiResponse = {
				id: cuid(),
				role: 'assistant',
				content: `This is a simulated response to: "${userMessage.content}"`,
			};
			setMessages(prev => [...prev, aiResponse]);
		}, 1000);
	};

	return (
		<div className="flex flex-col h-[calc(100vh-8rem)] w-full">
			<ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
				<div className="flex flex-col space-y-4">
					{messages.map(msg => (
						<MessageBubble key={msg.id} message={msg} />
					))}
				</div>
			</ScrollArea>

			<div className="p-4 border-t border-border/40">
				<ChatInput
					value={inputValue}
					onChange={e => setInputValue(e.target.value)}
					onSendMessage={handleSendMessage}
				/>
			</div>
		</div>
	);
}
