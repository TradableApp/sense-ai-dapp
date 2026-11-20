import { type ReactNode, useId } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SwitchedOffButtonProps {
	label: string;
	/** Why it is off, shown in its tooltip and read as its description. */
	reason: string;
	className?: string;
	children: ReactNode;
}

/**
 * An icon button for an action that is switched off. It is marked disabled with
 * `aria-disabled` rather than the native attribute, so it stays in the Tab order and its
 * reason shows on focus as on hover; a click, Enter or Space does nothing, and does not
 * reach a clickable parent.
 */
export default function SwitchedOffButton({
	label,
	reason,
	className,
	children,
}: SwitchedOffButtonProps) {
	const reasonId = useId();
	return (
		<>
			<TooltipProvider>
				<Tooltip delayDuration={100}>
					<TooltipTrigger asChild>
						<Button
							aria-label={label}
							aria-describedby={reasonId}
							aria-disabled="true"
							variant="ghost"
							size="icon"
							className={cn('cursor-not-allowed opacity-50', className)}
							onClick={event => {
								// Nothing happens, here or in a clickable parent.
								event.preventDefault();
								event.stopPropagation();
							}}
						>
							{children}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>{reason}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<span id={reasonId} className="sr-only">
				{reason}
			</span>
		</>
	);
}
