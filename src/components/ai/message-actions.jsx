'use client';

import { ArrowLeftIcon, ArrowRightIcon, RefreshCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import cn from '@/lib/utils';

export function MessageActions({
	className,
	isAssistant,
	isAiThinking,
	branch,
	onRegenerate,
	onBranchChange,
	...props
}) {
	// Do not show actions for user messages or while the AI is thinking for the very first time.
	if (!isAssistant || (isAiThinking && !branch)) {
		return null;
	}

	const showRegenerate = !isAiThinking;
	const showPager = branch && branch.count > 1;

	return (
		<div className={cn('not-prose ml-10 mt-2 flex items-center gap-2', className)} {...props}>
			{showRegenerate && (
				<Button variant="ghost" size="icon" className="size-7" onClick={onRegenerate}>
					<RefreshCcwIcon className="size-3.5" />
					<span className="sr-only">Regenerate response</span>
				</Button>
			)}

			{showPager && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						disabled={branch.index === 0}
						onClick={() => onBranchChange(branch.index - 1)}
					>
						<ArrowLeftIcon className="size-3.5" />
					</Button>
					<span>
						{branch.index + 1} / {branch.count}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						disabled={branch.index === branch.count - 1}
						onClick={() => onBranchChange(branch.index + 1)}
					>
						<ArrowRightIcon className="size-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
}
