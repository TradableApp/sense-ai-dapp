import { type MouseEvent, useId } from 'react';

import { FilePenLine, MoreHorizontal, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';

interface ConversationActionsMenuProps {
	isSessionReady: boolean;
	hasActivePlan: boolean;
	hasPendingPrompts: boolean;
	onRename: (_e: MouseEvent) => void;
	onDelete: (_e: MouseEvent) => void;
}

/** Why delete is off for a reason of the user's own, or null. */
function deleteBlocker(hasActivePlan: boolean, hasPendingPrompts: boolean): string | null {
	if (hasPendingPrompts) return 'Cannot delete while prompts are pending.';
	return hasActivePlan ? null : 'You must have an active plan to delete.';
}

/**
 * The rename and delete menu on a conversation in the history list. Each item is disabled
 * while it cannot be done, and says why in its tooltip and its accessible description.
 */
export default function ConversationActionsMenu({
	isSessionReady,
	hasActivePlan,
	hasPendingPrompts,
	onRename,
	onDelete,
}: ConversationActionsMenuProps) {
	// Renaming and deleting pay a fee; the switched-off reason comes first.
	const switchedOff = useSwitchedOffReason('metadata');
	const renameReason =
		switchedOff ?? (hasActivePlan ? null : 'You must have an active plan to rename.');
	const deleteReason = switchedOff ?? deleteBlocker(hasActivePlan, hasPendingPrompts);
	const renameReasonId = useId();
	const deleteReasonId = useId();

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
									disabled={!!renameReason}
									aria-describedby={renameReason ? renameReasonId : undefined}
									onClick={e => !renameReason && onRename(e)}
								>
									<FilePenLine className="mr-2 size-4" />
									Rename
								</DropdownMenuItem>
							</div>
						</TooltipTrigger>
						{renameReason && (
							<TooltipContent>
								<p>{renameReason}</p>
							</TooltipContent>
						)}
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="w-full">
								<DropdownMenuItem
									className="text-destructive"
									disabled={!!deleteReason}
									aria-describedby={deleteReason ? deleteReasonId : undefined}
									onClick={e => !deleteReason && onDelete(e)}
								>
									<Trash2 className="mr-2 size-4" />
									Delete
								</DropdownMenuItem>
							</div>
						</TooltipTrigger>
						{deleteReason && (
							<TooltipContent>
								<p>{deleteReason}</p>
							</TooltipContent>
						)}
					</Tooltip>
				</TooltipProvider>
				<span id={renameReasonId} className="sr-only">
					{renameReason}
				</span>
				<span id={deleteReasonId} className="sr-only">
					{deleteReason}
				</span>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
