import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import Input from '@/components/ui/input';

export default function ChatInput({ value, onChange, onSendMessage, ...props }) {
	const handleKeyPress = event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			onSendMessage();
		}
	};

	return (
		<div className="relative flex w-full items-center space-x-2" {...props}>
			<Input
				placeholder="Ask SenseAI anything..."
				className="flex-1 pr-12"
				value={value}
				onChange={onChange}
				onKeyPress={handleKeyPress}
			/>
			<Button size="icon" className="absolute right-1" onClick={onSendMessage} disabled={!value}>
				<Send className="size-5" />
			</Button>
		</div>
	);
}
