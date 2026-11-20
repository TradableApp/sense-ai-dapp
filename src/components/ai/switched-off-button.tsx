import { type ReactNode, useId } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SwitchedOffButtonProps {
	label: string;
	/** Why it is off, shown in its tooltip and read as its description. */
	reason: string;
	className?: string;
	children: ReactNode;
}

/**
 * An icon button for an action that is switched off: disabled, with the reason in its
 * tooltip and as its accessible description, so a click never sends what would be refused.
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
						{/* A disabled button gets no pointer events: the wrapper takes the hover. */}
						<span className="inline-flex shrink-0">
							<Button
								aria-label={label}
								aria-describedby={reasonId}
								variant="ghost"
								size="icon"
								className={className}
								disabled
							>
								{children}
							</Button>
						</span>
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
