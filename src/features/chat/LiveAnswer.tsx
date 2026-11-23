import { useId } from 'react';

import ReactMarkdown from 'react-markdown';

import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import { Message, MessageAvatar, MessageContent } from '@/components/ai/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai/reasoning';
import type { LiveAnswerState } from '@/lib/liveReasoning/liveReducer';
import type { ActiveMessage } from '@/store/chatSlice';

import { markdownComponents, remarkPlugins } from './markdown';

/**
 * The parts of an answer the live reasoning overlay can fill while the stored answer is
 * awaited. They only render: the live view comes from `useLiveReasoning`, and once the stored
 * answer has content it is always what is shown.
 */

const asArray = <T,>(value: unknown): T[] | undefined =>
	Array.isArray(value) ? (value as T[]) : undefined;

/**
 * Says the answer above it is provisional. A real button, so it is reachable by Tab and has an
 * accessible name; its explanation is its description, shown on hover and focus. Motion is
 * opacity and transform only, and none under reduced motion.
 */
export function ProvisionalMark() {
	const explanationId = useId();
	return (
		<span className="group/mark relative inline-flex">
			<button
				type="button"
				data-testid="live-provisional-mark"
				aria-describedby={explanationId}
				className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 transition-[transform,background-color] duration-150 hover:-translate-y-px hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 active:translate-y-0 dark:text-amber-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
			>
				<span
					aria-hidden
					className="size-1.5 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none"
				/>
				Not yet confirmed
			</button>
			<span
				id={explanationId}
				role="tooltip"
				className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 w-64 translate-y-1 rounded-md border bg-popover p-2 text-xs normal-case text-popover-foreground opacity-0 shadow-md transition-[opacity,transform] duration-150 group-focus-within/mark:translate-y-0 group-focus-within/mark:opacity-100 group-hover/mark:translate-y-0 group-hover/mark:opacity-100 motion-reduce:transition-none"
			>
				Shown as the answer was written. It is replaced by the confirmed answer from your history
				when that arrives.
			</span>
		</span>
	);
}

/**
 * The answer text from the live stream, before the stored answer lands. It is not announced as
 * it arrives (`aria-live="off"` inside the conversation's log): the stored answer that replaces
 * it is, so the answer is read out once.
 */
export function ProvisionalAnswer({ text }: { text: string }) {
	return (
		<div data-testid="live-provisional-answer" aria-live="off" className="space-y-1.5">
			<Message from="assistant" answerState="provisional" className="items-start">
				<MessageContent className="border border-dashed border-amber-500/40">
					<div className="prose inherit-color prose-sm dark:prose-invert max-w-none">
						<ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
							{text}
						</ReactMarkdown>
					</div>
				</MessageContent>
				<MessageAvatar src={senseaiLogo} name="SenseAI" />
			</Message>
			<div className="ml-10">
				<ProvisionalMark />
			</div>
		</div>
	);
}

interface AssistantReasoningProps {
	message: ActiveMessage;
	/** The live view, used only while the stored answer has no content. */
	live: LiveAnswerState | undefined;
	isThinking: boolean;
}

/** An answer's reasoning: the live steps while it is awaited, the stored ones once it lands. */
export function AssistantReasoning({ message, live, isThinking }: AssistantReasoningProps) {
	const shown = isThinking ? live : undefined;
	const steps = shown
		? [...shown.steps]
		: asArray<{ title: string; description: string }>(message.reasoning);
	const sources = shown
		? [...shown.sources]
		: asArray<{ title: string; url: string }>(message.sources);
	const hasReasoning = (steps?.length ?? 0) > 0;

	return (
		<div className="ml-10">
			<Reasoning
				isStreaming={isThinking}
				defaultOpen={false}
				reasoningDuration={message.reasoningDuration}
				reasoningSteps={steps}
			>
				<ReasoningTrigger hidden={!hasReasoning} />
				<ReasoningContent
					hidden={!hasReasoning}
					reasoningSteps={steps}
					sources={sources}
					currentAttempt={shown?.attempt}
					data-testid={shown ? 'live-reasoning' : undefined}
				/>
			</Reasoning>
			{shown?.outcome === 'interrupted' && (
				<p data-testid="live-retrying" role="status" className="mt-2 text-xs text-muted-foreground">
					Retrying. The steps shown may be replaced.
				</p>
			)}
		</div>
	);
}

/**
 * A prompt sent from another device is known here only from the sync, with no answer
 * placeholder: its live steps and provisional answer are shown after it, and nothing at all
 * when nothing live has arrived.
 */
export function LiveAnswerTurn({ live }: { live: LiveAnswerState | undefined }) {
	if (!live || (live.steps.length === 0 && !live.answer)) return null;
	const placeholder: ActiveMessage = { id: live.answerMessageId, role: 'assistant', content: null };
	return (
		<div className="space-y-3">
			<AssistantReasoning message={placeholder} live={live} isThinking />
			{live.answer && <ProvisionalAnswer text={live.answer.text} />}
		</div>
	);
}
