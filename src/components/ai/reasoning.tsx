'use client';

import {
	createContext,
	memo,
	ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';

import EarlierAttempt from '@/components/ai/earlier-attempt';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai/source';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { currentAttemptOf, splitByAttempt } from '@/lib/reasoningAttempts';
import { cn } from '@/lib/utils';

interface ReasoningStep {
	title: string;
	description: string;
	/** The provider attempt that produced the step; none means attempt 1. */
	attempt?: number;
}

interface SourceItem {
	url: string;
	title: string;
	attempt?: number;
}

interface ReasoningContextValue {
	isStreaming: boolean;
	isOpen: boolean;
	setIsOpen: (_open: boolean) => void;
	reasoningDuration?: number;
	reasoningSteps?: ReasoningStep[];
}

interface ReasoningProps {
	className?: string;
	isStreaming?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (_open: boolean) => void;
	reasoningDuration?: number;
	reasoningSteps?: ReasoningStep[];
	children?: ReactNode;
	[key: string]: unknown;
}

interface ReasoningTriggerProps {
	className?: string;
	hidden?: boolean;
	[key: string]: unknown;
}

interface ReasoningContentProps {
	className?: string;
	hidden?: boolean;
	reasoningSteps?: ReasoningStep[];
	sources?: SourceItem[];
	/**
	 * The attempt shown as current when it is higher than any step's: live, a fallback starts
	 * before its first step arrives, and the steps so far move to "Earlier attempt" at once.
	 */
	currentAttempt?: number;
	[key: string]: unknown;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error('Reasoning components must be used within Reasoning');
	}
	return context;
};

interface TypedText {
	/** The description being typed. */
	target: string;
	/** How much of it is shown so far. */
	text: string;
}

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
	}: ReasoningProps) => {
		const [isOpen, setIsOpen] = useControllableState({
			prop: open,
			defaultProp: defaultOpen,
			onChange: onOpenChange,
		});

		const [hasAutoClosed, setHasAutoClosed] = useState(false);
		const hasAutoOpenedRef = useRef(false);

		useEffect(() => {
			// Only auto-open if streaming AND there are thoughts to display
			if (
				isStreaming &&
				(reasoningSteps?.length ?? 0) > 0 &&
				!isOpen &&
				!hasAutoOpenedRef.current
			) {
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

		const handleOpenChange = (newOpen: boolean) => {
			setIsOpen(newOpen);
			setHasAutoClosed(true);
		};

		const contextValue = useMemo(
			() => ({ isStreaming, isOpen, setIsOpen, reasoningDuration, reasoningSteps }),
			[isStreaming, isOpen, setIsOpen, reasoningDuration, reasoningSteps],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<Collapsible
					className={cn('not-prose', className ?? '')}
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

export const ReasoningTrigger = memo(({ className, hidden, ...props }: ReasoningTriggerProps) => {
	const { isStreaming, isOpen, reasoningDuration, reasoningSteps } = useReasoning();
	return (
		<CollapsibleTrigger
			className={cn(
				'flex items-center gap-2 text-muted-foreground text-sm',
				hidden ? 'cursor-default' : 'cursor-pointer',
				className ?? '',
			)}
			{...props}
		>
			{(isStreaming || (reasoningDuration ?? 0) > 0 || (reasoningSteps?.length ?? 0) > 0) && (
				<BrainIcon className="size-4" />
			)}

			{isStreaming ? (
				<p>Thinking...</p>
			) : (reasoningDuration ?? 0) > 0 ? (
				<p>Thought for {reasoningDuration} seconds</p>
			) : (reasoningSteps?.length ?? 0) > 0 ? (
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

export const ReasoningContent = memo(
	({
		className,
		hidden,
		reasoningSteps,
		sources,
		currentAttempt,
		...props
	}: ReasoningContentProps) => {
		const { isStreaming } = useReasoning();
		const reduceMotion = useReducedMotion();
		// What is being typed at each position, with the description it is typing. It is shown only
		// while the answer is awaited and only under a step with that same description: once the
		// stored record has content it is what is rendered, and a new run's step at a position
		// never shows what was typed for an earlier run there.
		const [animatedDescriptions, setAnimatedDescriptions] = useState<Record<string, TypedText>>({});
		const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
		// The tick that starts a step's typing. Cleared on unmount with the interval: left pending,
		// it would start an interval on a component that is gone.
		const typingStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const prevReasoningRef = useRef<ReasoningStep[]>([]);

		useEffect(
			() => () => {
				if (typingStartRef.current !== null) clearTimeout(typingStartRef.current);
				if (typingTimerRef.current !== null) clearInterval(typingTimerRef.current);
			},
			[],
		);

		useEffect(() => {
			const prevSteps = prevReasoningRef.current || [];
			const currentSteps = reasoningSteps || [];
			// Keyed by position: two steps may share a title.
			const simulateReasoningTyping = (step: ReasoningStep, key: string) => {
				const targetDescription = step.description || '';
				if (!targetDescription) return;
				// Under reduced motion the step is shown whole, with no typing.
				if (reduceMotion) {
					setAnimatedDescriptions(prev => ({
						...prev,
						[key]: { target: targetDescription, text: targetDescription },
					}));
					return;
				}
				setAnimatedDescriptions(prev => ({
					...prev,
					[key]: { target: targetDescription, text: '' },
				}));
				if (typingStartRef.current !== null) clearTimeout(typingStartRef.current);
				typingStartRef.current = setTimeout(() => {
					typingStartRef.current = null;
					let index = 0;
					if (typingTimerRef.current !== null) clearInterval(typingTimerRef.current);
					typingTimerRef.current = setInterval(() => {
						index += 1;
						const currentDescription = targetDescription.slice(0, index);
						setAnimatedDescriptions(prev => ({
							...prev,
							[key]: { target: targetDescription, text: currentDescription },
						}));
						if (currentDescription.length === targetDescription.length) {
							if (typingTimerRef.current !== null) clearInterval(typingTimerRef.current);
						}
					}, TYPING_INTERVAL);
				}, 0);
			};
			const stopTyping = () => {
				if (typingStartRef.current !== null) clearTimeout(typingStartRef.current);
				if (typingTimerRef.current !== null) clearInterval(typingTimerRef.current);
				typingStartRef.current = null;
				typingTimerRef.current = null;
			};
			// Once the answer is no longer awaited nothing typed is kept: the stored steps are shown
			// as they are, so the stored record landing after the live steps types nothing again.
			if (!isStreaming) {
				stopTyping();
				setAnimatedDescriptions(prev => (Object.keys(prev).length === 0 ? prev : {}));
			} else if (currentSteps.length < prevSteps.length) {
				// A reset: the new run starts with nothing typed.
				stopTyping();
				setAnimatedDescriptions({});
			} else if (currentSteps.length > prevSteps.length) {
				// Only a step arriving while the answer is awaited is typed out; the steps before it
				// are shown whole.
				stopTyping();
				setAnimatedDescriptions({});
				const newStep = currentSteps.at(-1);
				if (newStep) {
					simulateReasoningTyping(newStep, String(currentSteps.length - 1));
				}
			}
			prevReasoningRef.current = currentSteps;
		}, [reasoningSteps, isStreaming, reduceMotion]);

		const steps = Array.isArray(reasoningSteps) ? reasoningSteps : [];
		const allSources = Array.isArray(sources) ? sources : [];
		const attempt = currentAttemptOf([...steps, ...allSources], currentAttempt);
		const stepGroups = splitByAttempt(steps, attempt);
		const sourceGroups = splitByAttempt(allSources, attempt);
		const latestSources = sourceGroups.latest.map(({ item }) => item);
		const hasEarlier = stepGroups.earlier.length > 0 || sourceGroups.earlier.length > 0;

		return hidden ? null : (
			<CollapsibleContent
				className={cn(
					'mt-4 text-sm',
					'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
					className ?? '',
				)}
				// Live steps change as they are typed; inside the conversation's log that would be
				// read out character by character. The stored answer is what is announced.
				aria-live={isStreaming ? 'off' : undefined}
				{...props}
			>
				<div className="space-y-4 rounded-md border bg-muted/50 p-4">
					{hasEarlier && (
						<EarlierAttempt
							steps={stepGroups.earlier.map(({ item }) => item)}
							sources={sourceGroups.earlier.map(({ item }) => item)}
						/>
					)}
					{stepGroups.latest.map(({ item: step, index }) => {
						const isLastStep = index === steps.length - 1;
						const targetDescription = step.description || '';
						const typed = animatedDescriptions[String(index)];
						const animatedText =
							isStreaming && typed?.target === targetDescription ? typed.text : undefined;
						const isTyping =
							isLastStep &&
							animatedText !== undefined &&
							animatedText.length < targetDescription.length;
						return (
							// Steps carry no id of their own and titles can repeat; the position is stable
							// because steps are only ever appended.
							<div key={index} data-testid="reasoning-step">
								<h4 className="font-semibold text-foreground mb-1">{step.title}</h4>
								<p className="text-muted-foreground">
									{animatedText ?? targetDescription}
									{isTyping && <span className="animate-pulse">▍</span>}
								</p>
							</div>
						);
					})}
					{latestSources.length > 0 && (
						<Sources>
							<SourcesTrigger count={latestSources.length} />
							<SourcesContent>
								{/* The same source can come twice; sources are only ever appended. */}
								{latestSources.map((source: SourceItem, index: number) => (
									<Source
										// eslint-disable-next-line react/no-array-index-key
										key={index}
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
	},
);

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
