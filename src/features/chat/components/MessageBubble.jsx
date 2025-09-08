import { Card } from '@/components/ui/card';
import cn from '@/lib/utils';

export default function MessageBubble({ message }) {
	const { role, content } = message;
	const isUser = role === 'user';

	return (
		<div className={cn('flex w-full items-start justify-start', isUser && 'justify-end')}>
			<Card
				className={cn(
					'max-w-[80%] p-3 text-left',
					isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
				)}
			>
				<p className="whitespace-pre-wrap">{content}</p>
			</Card>
		</div>
	);
}
