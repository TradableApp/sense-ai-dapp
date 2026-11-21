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

import SwitchedOffButton from '@/components/ai/switched-off-button';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';
import { cn, copyMarkdownToClipboard } from '@/lib/utils';

interface UserMessageActionsProps {
	message?: any;
	versionInfo?: any;
	onEdit?: () => void;
	onNavigate?: (_direction: string) => void;
	/**
	 * Set while this conversation holds a paid send that was not saved on this device: saving
	 * an edit sends a paid prompt, so edit is off and says why.
	 */
	heldReason?: string | null;
}

export default function UserMessageActions({
	message,
	versionInfo,
	onEdit,
	onNavigate,
	heldReason = null,
}: UserMessageActionsProps) {
	const [isCopied, setIsCopied] = useState(false);
	// Editing a prompt sends it again, so it is off while prompts are.
	const editSwitchedOff = useSwitchedOffReason('prompt');
	// Also off while this conversation holds a paid send not saved here.
	const editOff = editSwitchedOff ?? heldReason;

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
					{/* Pending is on the chain and waiting for its answer, not still being sent. */}
					{message.status === 'pending' && isUser && (
						<>
							<span className="size-1.5 rounded-full bg-current animate-pulse" />
							<span>Awaiting answer</span>
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
							aria-label={isCopied ? 'Copied' : 'Copy'}
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

			{editOff ? (
				<SwitchedOffButton
					label="Edit message"
					reason={editOff}
					className="size-7 text-muted-foreground"
				>
					<PencilIcon className="size-4" />
				</SwitchedOffButton>
			) : (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								aria-label="Edit message"
								onClick={() => onEdit?.()}
							>
								<PencilIcon className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Edit message</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}

			{showPagination && (
				<div className="flex items-center gap-1 text-xs text-muted-foreground">
					<Button
						variant="ghost"
						size="icon"
						className="size-5"
						aria-label="Previous version"
						onClick={() => onNavigate?.(versionInfo.siblings[versionInfo.currentIndex - 1])}
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
						aria-label="Next version"
						onClick={() => onNavigate?.(versionInfo.siblings[versionInfo.currentIndex + 1])}
						disabled={versionInfo.currentIndex === versionInfo.siblings.length - 1}
					>
						<ChevronRightIcon className="size-3" />
					</Button>
				</div>
			)}
		</div>
	);
}
