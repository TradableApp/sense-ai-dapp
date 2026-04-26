'use client';

import { useCallback, ReactNode } from 'react';

import { ArrowDownIcon } from 'lucide-react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConversationProps {
	className?: string;
	children: ReactNode;
}

interface ConversationContentProps {
	className?: string;
	children: ReactNode;
}

interface ConversationScrollButtonProps {
	className?: string;
	children?: ReactNode;
}

export function Conversation({ className, ...props }: ConversationProps) {
	return (
		<StickToBottom
			className={cn('relative flex-1 overflow-y-auto', className)}
			initial="smooth"
			resize="smooth"
			role="log"
			{...props}
		/>
	);
}

export function ConversationContent({ className, ...props }: ConversationContentProps) {
	return <StickToBottom.Content className={cn('p-4', className)} {...props} />;
}

export function ConversationScrollButton({ className, ...props }: ConversationScrollButtonProps) {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	const handleScrollToBottom = useCallback(() => {
		scrollToBottom();
	}, [scrollToBottom]);
	return (
		!isAtBottom && (
			<Button
				className={cn('absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full', className)}
				onClick={handleScrollToBottom}
				size="icon"
				type="button"
				variant="outline"
				{...props}
			>
				<ArrowDownIcon className="size-4" />
			</Button>
		)
	);
}
