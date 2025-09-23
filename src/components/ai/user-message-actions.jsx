import { useState } from 'react';

import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, PencilIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { copyMarkdownToClipboard } from '@/lib/utils';

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

	const showPagination = versionInfo && versionInfo.siblings.length > 1;

	return (
		<div className="flex justify-end items-center gap-1 mr-10">
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
