import { useState } from 'react';

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
}) {
	const [isCopied, setIsCopied] = useState(false);
	const [rating, setRating] = useState(null);

	const handleCopy = async () => {
		if (!message?.content) return;
		const success = await copyMarkdownToClipboard(message.content);
		if (success) {
			setIsCopied(true);
			setTimeout(() => setIsCopied(false), 2000);
		}
	};

	const handleRate = newRating => {
		setRating(prevRating => (prevRating === newRating ? null : newRating));
	};

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

			{rating !== 'bad' && (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								onClick={() => handleRate('good')}
							>
								<ThumbsUp
									className="size-4"
									style={{
										color: rating === 'good' ? '#9939F1' : 'inherit',
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

			{rating !== 'good' && (
				<TooltipProvider>
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								onClick={() => handleRate('bad')}
							>
								<ThumbsDown
									className="size-4"
									style={{
										color: rating === 'bad' ? '#9939F1' : 'inherit',
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
