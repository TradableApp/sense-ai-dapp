'use client';

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai/source';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const ReasoningContext = createContext(null);

const useReasoning = () => {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error('Reasoning components must be used within Reasoning');
	}
	return context;
};

const AUTO_CLOSE_DELAY = 1000;
const TYPING_INTERVAL = 30;

export const Reasoning = memo(
	({
		className,
		isStreaming = false,
		open,
		defaultOpen = false,
		onOpenChange,
		reasoningDuration,
		reasoningSteps, // Accept reasoningSteps as a prop
		children,
		...props
	}) => {
		const [isOpen, setIsOpen] = useControllableState({
			prop: open,
			defaultProp: defaultOpen,
			onChange: onOpenChange,
		});

		const [hasAutoClosed, setHasAutoClosed] = useState(false);
		const hasAutoOpenedRef = useRef(false);

		useEffect(() => {
			// Only auto-open if streaming AND there are thoughts to display
			if (isStreaming && reasoningSteps?.length > 0 && !isOpen && !hasAutoOpenedRef.current) {
				setIsOpen(true);
				hasAutoOpenedRef.current = true;
			} else if (!isStreaming && isOpen && !defaultOpen && !hasAutoClosed) {
				const timer = setTimeout(() => {
					setIsOpen(false);
					setHasAutoClosed(true);
				}, AUTO_CLOSE_DELAY);
				return () => clearTimeout(timer);
			}
			if (!isStreaming) {
				hasAutoOpenedRef.current = false;
			}
			return undefined;
		}, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed, reasoningSteps]);

		const handleOpenChange = newOpen => {
			setIsOpen(newOpen);
			setHasAutoClosed(true);
		};

		const contextValue = useMemo(
			() => ({ isStreaming, isOpen, setIsOpen, reasoningDuration }),
			[isStreaming, isOpen, setIsOpen, reasoningDuration],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<Collapsible
					className={cn('not-prose', className)}
					onOpenChange={handleOpenChange}
					open={isOpen}
					{...props}
				>
					{children}
				</Collapsible>
			</ReasoningContext.Provider>
		);
	},
);

export const ReasoningTrigger = memo(({ className, hidden, ...props }) => {
	const { isStreaming, isOpen, reasoningDuration, reasoningSteps } = useReasoning();
	return (
		<CollapsibleTrigger
			className={cn(
				'flex items-center gap-2 text-muted-foreground text-sm',
				hidden ? 'cursor-default' : 'cursor-pointer',
				className,
			)}
			{...props}
		>
			{(isStreaming || reasoningDuration > 0 || reasoningSteps?.length > 0) && (
				<BrainIcon className="size-4" />
			)}

			{isStreaming ? (
				<p>Thinking...</p>
			) : reasoningDuration > 0 ? (
				<p>Thought for {reasoningDuration} seconds</p>
			) : reasoningSteps?.length > 0 ? (
				<p>Reasoning</p>
			) : null}

			{!hidden && (
				<ChevronDownIcon
					className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
				/>
			)}
		</CollapsibleTrigger>
	);
});

export const ReasoningContent = memo(({ className, hidden, reasoningSteps, sources, ...props }) => {
	const { isStreaming } = useReasoning();
	const [animatedDescriptions, setAnimatedDescriptions] = useState({});
	const typingTimerRef = useRef(null);
	const prevReasoningRef = useRef([]);

	useEffect(() => () => clearInterval(typingTimerRef.current), []);

	useEffect(() => {
		const prevSteps = prevReasoningRef.current || [];
		const currentSteps = reasoningSteps || [];
		const simulateReasoningTyping = step => {
			const targetDescription = step.description || '';
			if (!targetDescription) return;
			setAnimatedDescriptions(prev => ({ ...prev, [step.title]: '' }));
			const timerId = setTimeout(() => {
				let index = 0;
				clearInterval(typingTimerRef.current);
				typingTimerRef.current = setInterval(() => {
					index += 1;
					const currentDescription = targetDescription.slice(0, index);
					setAnimatedDescriptions(prev => ({ ...prev, [step.title]: currentDescription }));
					if (currentDescription.length === targetDescription.length) {
						clearInterval(typingTimerRef.current);
					}
				}, TYPING_INTERVAL);
			}, 0);
			return () => clearTimeout(timerId);
		};
		if (currentSteps.length > prevSteps.length) {
			const newStep = currentSteps.at(-1);
			const previousStep = prevSteps.at(-1);
			if (previousStep) {
				setAnimatedDescriptions(prev => ({
					...prev,
					[previousStep.title]: previousStep.description || '',
				}));
			}
			simulateReasoningTyping(newStep);
		}
		if (!isStreaming && prevReasoningRef.current?.length > 0) {
			clearInterval(typingTimerRef.current);
			const lastStep = prevReasoningRef.current.at(-1);
			if (lastStep) {
				setAnimatedDescriptions(prev => ({
					...prev,
					[lastStep.title]: lastStep.description || '',
				}));
			}
		}
		prevReasoningRef.current = currentSteps;
	}, [reasoningSteps, isStreaming]);

	return hidden ? null : (
		<CollapsibleContent
			className={cn(
				'mt-4 text-sm',
				'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
				className,
			)}
			{...props}
		>
			<div className="space-y-4 rounded-md border bg-muted/50 p-4">
				{Array.isArray(reasoningSteps) &&
					reasoningSteps.map((step, index) => {
						const isLastStep = index === reasoningSteps.length - 1;
						const animatedText = animatedDescriptions[step.title];
						const targetDescription = step.description || '';
						const isTyping =
							isStreaming && isLastStep && (animatedText?.length ?? 0) < targetDescription.length;
						return (
							<div key={step.title}>
								<h4 className="font-semibold text-foreground mb-1">{step.title}</h4>
								<p className="text-muted-foreground">
									{animatedText ?? targetDescription}
									{isTyping && <span className="animate-pulse">▍</span>}
								</p>
							</div>
						);
					})}
				{sources && sources.length > 0 && (
					<Sources>
						<SourcesTrigger count={sources.length} />
						<SourcesContent>
							{sources.map(source => (
								<Source
									key={`${source.url}${source.title}`}
									href={source.url}
									title={source.title}
								/>
							))}
						</SourcesContent>
					</Sources>
				)}
			</div>
		</CollapsibleContent>
	);
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
