'use client';

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import cn from '@/lib/utils';

const ReasoningContext = createContext(null);

const useReasoning = () => {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error('Reasoning components must be used within Reasoning');
	}
	return context;
};

const AUTO_CLOSE_DELAY = 1000;
const TYPING_INTERVAL = 30; // ms per character for reasoning description

export const Reasoning = memo(
	({
		className,
		isStreaming = false,
		open,
		defaultOpen = false,
		onOpenChange,
		duration: durationProp,
		children,
		...props
	}) => {
		const [isOpen, setIsOpen] = useControllableState({
			prop: open,
			defaultProp: defaultOpen,
			onChange: onOpenChange,
		});
		const [duration, setDuration] = useControllableState({
			prop: durationProp,
			defaultProp: 0,
		});

		const [hasAutoClosed, setHasAutoClosed] = useState(false);
		const [startTime, setStartTime] = useState(null);
		// --- FIX: Ref to ensure we only auto-open once per streaming session ---
		const hasAutoOpenedRef = useRef(false);

		// Track duration when streaming starts and ends
		useEffect(() => {
			if (isStreaming) {
				if (startTime === null) {
					setStartTime(Date.now());
				}
			} else if (startTime !== null) {
				setDuration(Math.round((Date.now() - startTime) / 1000));
				setStartTime(null);
			}
		}, [isStreaming, startTime, setDuration]);

		// Auto-open/close logic
		useEffect(() => {
			// --- FIX: Only auto-open once when streaming begins. After that, the user has control. ---
			if (isStreaming && !isOpen && !hasAutoOpenedRef.current) {
				setIsOpen(true);
				hasAutoOpenedRef.current = true;
			} else if (!isStreaming && isOpen && !defaultOpen && !hasAutoClosed) {
				const timer = setTimeout(() => {
					setIsOpen(false);
					setHasAutoClosed(true);
				}, AUTO_CLOSE_DELAY);
				return () => clearTimeout(timer);
			}

			// When streaming stops, reset the lock so the next stream can auto-open again.
			if (!isStreaming) {
				hasAutoOpenedRef.current = false;
			}
			return undefined;
		}, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed]);

		const handleOpenChange = newOpen => {
			setIsOpen(newOpen);
			// If the user interacts manually, prevent it from auto-closing at the end.
			setHasAutoClosed(true);
		};

		const contextValue = useMemo(
			() => ({ isStreaming, isOpen, setIsOpen, duration }),
			[isStreaming, isOpen, setIsOpen, duration],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<Collapsible
					className={cn('not-prose mb-4', className)}
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

export const ReasoningTrigger = memo(({ className, title = 'Reasoning', children, ...props }) => {
	const { isStreaming, isOpen, duration } = useReasoning();
	return (
		<CollapsibleTrigger
			className={cn('flex items-center gap-2 text-muted-foreground text-sm', className)}
			{...props}
		>
			{children ?? (
				<>
					<BrainIcon className="size-4" />
					{isStreaming || duration === 0 ? (
						<p>Thinking...</p>
					) : (
						<p>Thought for {duration} seconds</p>
					)}
					<ChevronDownIcon
						className={cn(
							'size-4 text-muted-foreground transition-transform',
							isOpen ? 'rotate-180' : 'rotate-0',
						)}
					/>
				</>
			)}
		</CollapsibleTrigger>
	);
});

export const ReasoningContent = memo(({ className, children: reasoningSteps, ...props }) => {
	const { isStreaming } = useReasoning();
	const [animatedDescriptions, setAnimatedDescriptions] = useState({});
	const typingTimerRef = useRef(null);
	const prevReasoningRef = useRef([]);

	useEffect(
		() =>
			// General cleanup for the timer when the component unmounts
			() =>
				clearInterval(typingTimerRef.current),
		[],
	);

	// --- FIX: This useEffect now robustly handles the animation for all steps ---
	useEffect(() => {
		const prevSteps = prevReasoningRef.current || [];
		const currentSteps = reasoningSteps || [];

		const simulateReasoningTyping = step => {
			const targetDescription = step.description || '';
			if (!targetDescription) return;

			setAnimatedDescriptions(prev => ({ ...prev, [step.title]: '' }));

			// Defer the interval creation to prevent a race condition with React's state updates.
			const timerId = setTimeout(() => {
				let index = 0;
				clearInterval(typingTimerRef.current); // Clear any lingering timer.
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

		// A new step has been added.
		if (currentSteps.length > prevSteps.length) {
			const newStep = currentSteps[currentSteps.length - 1];
			const previousStep = prevSteps.at(-1);

			// Instantly complete the previous step's animation.
			if (previousStep) {
				setAnimatedDescriptions(prev => ({
					...prev,
					[previousStep.title]: previousStep.description || '',
				}));
			}
			simulateReasoningTyping(newStep);
		}

		// Streaming has just ended.
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

	return (
		<CollapsibleContent
			className={cn(
				'mt-4 text-sm',
				'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
				className,
			)}
			{...props}
		>
			<div className="space-y-4 rounded-md border bg-muted/50 p-4">
				{Array.isArray(reasoningSteps) ? (
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
					})
				) : (
					<p className="text-muted-foreground">{reasoningSteps}</p>
				)}
			</div>
		</CollapsibleContent>
	);
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
