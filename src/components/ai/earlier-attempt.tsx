import { ChevronDownIcon, HistoryIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface EarlierAttemptProps {
	steps: ReadonlyArray<{ title: string; description: string }>;
	sources: ReadonlyArray<{ title: string; url: string }>;
}

const countLabel = (steps: number, sources: number) =>
	[
		steps > 0 ? `${steps} step${steps === 1 ? '' : 's'}` : null,
		sources > 0 ? `${sources} source${sources === 1 ? '' : 's'}` : null,
	]
		.filter(Boolean)
		.join(', ');

/**
 * The steps and sources of attempts that did not answer (the oracle fell back to another
 * provider). Kept, closed by default and set back visually, so the reasoning that led to the
 * answer reads first. The trigger is a real button: reachable by Tab, named "Earlier attempt",
 * with its own hover and focus states; motion is transform and opacity only, and none at all
 * when the user asks for reduced motion.
 */
export default function EarlierAttempt({ steps, sources }: EarlierAttemptProps) {
	return (
		<Collapsible data-testid="reasoning-earlier-attempt" className="group/earlier">
			<CollapsibleTrigger className="inline-flex items-center gap-2 rounded-md px-2 py-1 -ml-2 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-x-0 motion-reduce:transition-none motion-reduce:hover:translate-x-0">
				<HistoryIcon className="size-3.5" aria-hidden />
				<span>Earlier attempt</span>
				<span className="font-normal normal-case tracking-normal opacity-70">
					({countLabel(steps.length, sources.length)})
				</span>
				<ChevronDownIcon
					className="size-3.5 transition-transform duration-150 group-data-[state=open]/earlier:rotate-180 motion-reduce:transition-none"
					aria-hidden
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 motion-reduce:animate-none">
				<div className="mt-2 space-y-3 border-l-2 border-dashed border-muted-foreground/30 pl-3 opacity-80">
					{steps.map((step, index) => (
						// Steps carry no id of their own; their position in the attempt is stable.
						// eslint-disable-next-line react/no-array-index-key
						<div key={index} data-testid="reasoning-step">
							<h4 className="font-semibold text-foreground/80 mb-1">{step.title}</h4>
							<p className="text-muted-foreground">{step.description}</p>
						</div>
					))}
					{sources.length > 0 && (
						<ul className="space-y-1 text-xs">
							{sources.map((source, index) => (
								// eslint-disable-next-line react/no-array-index-key
								<li key={index}>
									<a
										href={source.url}
										target="_blank"
										rel="noreferrer noopener"
										className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
									>
										{source.title}
									</a>
								</li>
							))}
						</ul>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
