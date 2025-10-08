import { useEffect, useState } from 'react';

import {
	BookText,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	Mic,
	MoreHorizontal,
	RotateCcwIcon,
	Share,
	Sparkles,
	Split,
	ThumbsDown,
	ThumbsUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/SessionProvider';
import sendAiFeedback from '@/lib/feedbackService';
import { copyMarkdownToClipboard } from '@/lib/utils';

function ActionButton({ label, icon, onClick }) {
	const Icon = icon;
	return (
		<TooltipProvider>
			<Tooltip delayDuration={100}>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 text-muted-foreground"
						onClick={onClick || (() => {})}
					>
						<Icon className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>{label}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function DropdownAction({ label, icon, children, align }) {
	const Icon = icon;
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);

	const handleDropdownOpenChange = open => {
		if (open) {
			setIsTooltipOpen(false);
		}
	};

	return (
		<DropdownMenu onOpenChange={handleDropdownOpenChange}>
			<TooltipProvider>
				<Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen} delayDuration={100}>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
								<Icon className="size-4" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>
						<p>{label}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<DropdownMenuContent align={align}>{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function MessageActions({
	message,
	versionInfo,
	onRegenerate,
	onNavigate,
	onBranch,
	initialFeedback,
}) {
	const { ownerAddress } = useSession();
	const [isCopied, setIsCopied] = useState(false);
	const [feedback, setFeedback] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		setFeedback(initialFeedback || null);
	}, [initialFeedback]);

	const handleCopy = async () => {
		if (!message?.content) return;
		const success = await copyMarkdownToClipboard(message.content);
		if (success) {
			setIsCopied(true);
			setTimeout(() => setIsCopied(false), 2000);
		}
	};

	const handleFeedback = async newFeedbackValue => {
		if (isSubmitting) return;

		const previousFeedback = feedback;
		const finalFeedback = previousFeedback === newFeedbackValue ? null : newFeedbackValue;

		// Optimistic UI update
		setFeedback(finalFeedback);
		setIsSubmitting(true);

		try {
			await sendAiFeedback({
				ownerAddress,
				conversationId: message.conversationId,
				messageId: message.id,
				parentId: message.parentId,
				feedbackValue: finalFeedback,
			});
			// On success, the optimistic state is now confirmed.
		} catch (error) {
			// On failure, revert the UI to its previous state.
			setFeedback(previousFeedback);
		} finally {
			setIsSubmitting(false);
		}
	};

	const canGiveFeedback = message.role === 'assistant' && message.content;
	const showPagination = versionInfo && versionInfo.siblings.length > 1;

	return (
		<div className="-mt-3 ml-10 flex items-center gap-2">
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

			{feedback !== 'dislike' && (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								onClick={() => handleFeedback('like')}
								disabled={!canGiveFeedback || isSubmitting}
							>
								<ThumbsUp
									className="size-4"
									style={{
										color: feedback === 'like' ? '#9939F1' : 'inherit',
									}}
								/>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Good response</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}

			{feedback !== 'like' && (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								onClick={() => handleFeedback('dislike')}
								disabled={!canGiveFeedback || isSubmitting}
							>
								<ThumbsDown
									className="size-4"
									style={{
										color: feedback === 'dislike' ? '#9939F1' : 'inherit',
									}}
								/>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Bad response</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}

			<ActionButton label="Share" icon={Share} />

			<DropdownAction label="Try again" icon={RotateCcwIcon} align="start">
				<DropdownMenuItem onClick={() => onRegenerate('default')}>
					<RotateCcwIcon className="mr-2 size-4" />
					Try again
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onRegenerate('detailed')}>
					<BookText className="mr-2 size-4" />
					Add details
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onRegenerate('concise')}>
					<Sparkles className="mr-2 size-4" />
					More concise
				</DropdownMenuItem>
			</DropdownAction>

			<DropdownAction label="More actions" icon={MoreHorizontal} align="end">
				<DropdownMenuItem onClick={onBranch}>
					<Split className="mr-2 size-4 rotate-90" />
					Branch in new chat
				</DropdownMenuItem>
				<DropdownMenuItem>
					<Mic className="mr-2 size-4" />
					Read aloud
				</DropdownMenuItem>
			</DropdownAction>
		</div>
	);
}
