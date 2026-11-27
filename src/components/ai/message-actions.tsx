import { ReactNode, useEffect, useState } from 'react';

import {
	BookText,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	LucideIcon,
	MoreHorizontal,
	RotateCcwIcon,
	Share,
	Sparkles,
	Split,
	ThumbsDown,
	ThumbsUp,
} from 'lucide-react';

import SENDING_REASON from '@/components/ai/sendingReason';
import SwitchedOffButton from '@/components/ai/switched-off-button';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/SessionProvider';
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';
import type { AnswerRating } from '@/lib/answerRating';
import sendAiFeedback from '@/lib/feedbackService';
import { copyMarkdownToClipboard } from '@/lib/utils';

interface ActionButtonProps {
	label: string;
	icon: LucideIcon;
	onClick?: () => void;
}

interface DropdownActionProps {
	label: string;
	icon: LucideIcon;
	children?: ReactNode;
	align?: 'center' | 'end' | 'start';
	/** Set while the menu's action is switched off: the trigger is disabled and says why. */
	disabledReason?: string | null;
}

interface MessageActionsProps {
	message: any;
	versionInfo?: any;
	onRegenerate?: (_mode?: string) => void;
	onNavigate?: (_direction: string) => void;
	onBranch?: () => void;
	initialFeedback?: AnswerRating | null;
	/** Told the rating once it is saved (null when removed), so it shows when the chat is reopened. */
	onFeedbackSaved?: (_value: AnswerRating | null) => void;
	/** True while a prompt is being sent: regenerate and branch are then off, and say why. */
	isSending?: boolean;
	/**
	 * Set while a paid send from this answer was confirmed but not saved on this device:
	 * regenerate and branch are then off, and say why. Cancel and refund are never held.
	 */
	heldReason?: string | null;
}

function ActionButton({ label, icon, onClick }: ActionButtonProps) {
	const Icon = icon;
	return (
		<TooltipProvider>
			<Tooltip delayDuration={100}>
				<TooltipTrigger asChild>
					<Button
						aria-label={label}
						variant="ghost"
						size="icon"
						className="size-7 text-muted-foreground shrink-0"
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

function DropdownAction({ label, icon, children, align, disabledReason }: DropdownActionProps) {
	const Icon = icon;
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);

	if (disabledReason) {
		return (
			<SwitchedOffButton
				label={label}
				reason={disabledReason}
				className="size-7 text-muted-foreground shrink-0"
			>
				<Icon className="size-4" />
			</SwitchedOffButton>
		);
	}

	const handleDropdownOpenChange = (open: boolean) => {
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
							<Button
								aria-label={label}
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground shrink-0"
							>
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
	onFeedbackSaved,
	isSending = false,
	heldReason = null,
}: MessageActionsProps) {
	const { sessionKey } = useSession();
	const [isCopied, setIsCopied] = useState(false);
	const [feedback, setFeedback] = useState<AnswerRating | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const regenerateSwitchedOff = useSwitchedOffReason('prompt');
	const branchSwitchedOff = useSwitchedOffReason('branch');
	// Each also waits while a prompt is being sent, so a second choice sends nothing.
	const sendingReason = isSending ? SENDING_REASON : null;

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

	const handleFeedback = async (newFeedbackValue: AnswerRating) => {
		if (isSubmitting || !sessionKey) return;

		const previousFeedback = feedback;
		const finalFeedback = previousFeedback === newFeedbackValue ? null : newFeedbackValue;

		// Optimistic UI update
		setFeedback(finalFeedback);
		setIsSubmitting(true);

		try {
			await sendAiFeedback({
				sessionKey,
				conversationId: message.conversationId,
				messageId: message.id,
				feedbackValue: finalFeedback,
			});
			// On success, the optimistic state is now confirmed.
			onFeedbackSaved?.(finalFeedback);
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
		<div className="-mt-3 ml-0 md:ml-10 flex items-center gap-2 overflow-x-auto">
			{showPagination && (
				<div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
					<Button
						aria-label="Previous version"
						variant="ghost"
						size="icon"
						className="size-5"
						onClick={() => onNavigate?.(versionInfo.siblings[versionInfo.currentIndex - 1])}
						disabled={versionInfo.currentIndex === 0}
					>
						<ChevronLeftIcon className="size-3" />
					</Button>
					<span className="whitespace-nowrap">
						{versionInfo.currentIndex + 1} / {versionInfo.siblings.length}
					</span>
					<Button
						aria-label="Next version"
						variant="ghost"
						size="icon"
						className="size-5"
						onClick={() => onNavigate?.(versionInfo.siblings[versionInfo.currentIndex + 1])}
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
							className="size-7 text-muted-foreground shrink-0"
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

			{feedback !== 'dislike' && (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="ph-no-capture size-7 text-muted-foreground shrink-0"
								aria-label="Good response"
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
								className="ph-no-capture size-7 text-muted-foreground shrink-0"
								aria-label="Bad response"
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

			<DropdownAction
				label="Try again"
				icon={RotateCcwIcon}
				align="start"
				disabledReason={regenerateSwitchedOff ?? sendingReason ?? heldReason}
			>
				<DropdownMenuItem onClick={() => onRegenerate?.('default')}>
					<RotateCcwIcon className="mr-2 size-4" />
					Try again
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onRegenerate?.('detailed')}>
					<BookText className="mr-2 size-4" />
					Add details
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onRegenerate?.('concise')}>
					<Sparkles className="mr-2 size-4" />
					More concise
				</DropdownMenuItem>
			</DropdownAction>

			{/*
				The branch's switched-off reason, or a prompt being sent, disables this whole trigger,
				so the menu cannot be opened at all while branching is off. That is right only because
				the menu holds the branch alone today. Anything added to it needs its own switched-off handling on its
				own item, and the trigger must then stop sharing this flag.
			*/}
			<DropdownAction
				label="More actions"
				icon={MoreHorizontal}
				align="end"
				disabledReason={branchSwitchedOff ?? sendingReason ?? heldReason}
			>
				<DropdownMenuItem onClick={() => onBranch?.()}>
					<Split className="mr-2 size-4 rotate-90" />
					Branch in new chat
				</DropdownMenuItem>
				{/* <DropdownMenuItem>
					<Mic className="mr-2 size-4" />
					Read aloud
				</DropdownMenuItem> */}
			</DropdownAction>
		</div>
	);
}
