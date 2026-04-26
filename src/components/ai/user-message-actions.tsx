import { useState } from 'react';

import {
	Ban,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	PencilIcon,
	RotateCcw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, copyMarkdownToClipboard } from '@/lib/utils';

export default function UserMessageActions({ message, versionInfo, onEdit, onNavigate }) {
	const [isCopied, setIsCopied] = useState(false);

	const handleCopy = async () => {
		if (!message?.content) return;
		const success = await copyMarkdownToClipboard(message.content);
		if (success) {
			setIsCopied(true);
			setTimeout(() => setIsCopied(false), 2000);
		}
	};

	const isUser = message?.role === 'user';
	const showPagination = versionInfo && versionInfo.siblings.length > 1;

	return (
		<div className="flex justify-end items-center gap-1 mr-10">
			{message?.status && (
				<div
					className={cn(
						'mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider',
						// Add margin to align with the bubble, not the avatar (Avatar is size-8 = 32px + gap-2)
						'mr-4 text-left',
						message.status === 'refunded' ? 'text-amber-500' : 'text-muted-foreground/60',
					)}
				>
					{message.status === 'cancelled' && (
						<>
							<Ban className="size-3" />
							<span>Cancelled</span>
						</>
					)}
					{message.status === 'refunded' && (
						<>
							<RotateCcw className="size-3" />
							<span>Refunded</span>
						</>
					)}
					{message.status === 'pending' && isUser && (
						<>
							<span className="size-1.5 rounded-full bg-current animate-pulse" />
							<span>Sending...</span>
						</>
					)}
				</div>
			)}

			<TooltipProvider>
				<Tooltip delayDuration={100}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 text-muted-foreground"
							onClick={handleCopy}
						>
							{isCopied ? (
								<CheckIcon className="size-4 text-green-500" />
							) : (
								<CopyIcon className="size-4" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>{isCopied ? 'Copied!' : 'Copy'}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			<TooltipProvider>
				<Tooltip delayDuration={100}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 text-muted-foreground"
							onClick={onEdit}
						>
							<PencilIcon className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>Edit message</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			{showPagination && (
				<div className="flex items-center gap-1 text-xs text-muted-foreground">
					<Button
						variant="ghost"
						size="icon"
						className="size-5"
						onClick={() => onNavigate(versionInfo.siblings[versionInfo.currentIndex - 1])}
						disabled={versionInfo.currentIndex === 0}
					>
						<ChevronLeftIcon className="size-3" />
					</Button>
					<span>
						{versionInfo.currentIndex + 1} / {versionInfo.siblings.length}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="size-5"
						onClick={() => onNavigate(versionInfo.siblings[versionInfo.currentIndex + 1])}
						disabled={versionInfo.currentIndex === versionInfo.siblings.length - 1}
					>
						<ChevronRightIcon className="size-3" />
					</Button>
				</div>
			)}
		</div>
	);
}
