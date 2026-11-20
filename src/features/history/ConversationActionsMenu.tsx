import type { MouseEvent } from 'react';

import { FilePenLine, MoreHorizontal, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ConversationActionsMenuProps {
	isSessionReady: boolean;
	hasActivePlan: boolean;
	hasPendingPrompts: boolean;
	onRename: (_e: MouseEvent) => void;
	onDelete: (_e: MouseEvent) => void;
}

/** The rename and delete menu on a conversation in the history list. */
export default function ConversationActionsMenu({
	isSessionReady,
	hasActivePlan,
	hasPendingPrompts,
	onRename,
	onDelete,
}: ConversationActionsMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-haspopup="true"
					size="icon"
					variant="ghost"
					onClick={e => e.stopPropagation()}
					disabled={!isSessionReady}
				>
					<MoreHorizontal className="size-4" />
					<span className="sr-only">Toggle menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="w-full">
								<DropdownMenuItem
									disabled={!hasActivePlan}
									onClick={e => hasActivePlan && onRename(e)}
								>
									<FilePenLine className="mr-2 size-4" />
									Rename
								</DropdownMenuItem>
							</div>
						</TooltipTrigger>
						{!hasActivePlan && (
							<TooltipContent>
								<p>You must have an active plan to rename.</p>
							</TooltipContent>
						)}
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="w-full">
								<DropdownMenuItem
									className="text-destructive"
									disabled={!hasActivePlan || hasPendingPrompts}
									onClick={e => hasActivePlan && !hasPendingPrompts && onDelete(e)}
								>
									<Trash2 className="mr-2 size-4" />
									Delete
								</DropdownMenuItem>
							</div>
						</TooltipTrigger>
						{(!hasActivePlan || hasPendingPrompts) && (
							<TooltipContent>
								<p>
									{hasPendingPrompts
										? 'Cannot delete while prompts are pending.'
										: 'You must have an active plan to delete.'}
								</p>
							</TooltipContent>
						)}
					</Tooltip>
				</TooltipProvider>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
