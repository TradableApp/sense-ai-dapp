import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Reasoning, ReasoningContent } from './reasoning';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', () => ({ useReducedMotion: () => motion.reduced }));

interface Step {
	title: string;
	description: string;
	attempt?: number;
}

function renderSteps(
	steps: Step[],
	extra: {
		currentAttempt?: number;
		sources?: Array<{ title: string; url: string; attempt?: number }>;
	} = {},
) {
	return render(
		<Reasoning defaultOpen reasoningSteps={steps}>
			<ReasoningContent reasoningSteps={steps} {...extra} />
		</Reasoning>,
	);
}

const stepTitles = (root: HTMLElement) =>
	within(root)
		.queryAllByTestId('reasoning-step')
		.map(el => el.querySelector('h4')?.textContent);

afterEach(() => {
	cleanup();
	motion.reduced = false;
});

describe('ReasoningContent', () => {
	it('shows two steps that share a title, each once (keyed by position, not title)', () => {
		renderSteps([
			{ title: 'Checking', description: 'First.' },
			{ title: 'Checking', description: 'Second.' },
		]);

		expect(screen.getAllByTestId('reasoning-step')).toHaveLength(2);
		expect(screen.getByText('First.')).toBeTruthy();
		expect(screen.getByText('Second.')).toBeTruthy();
	});

	it('shows stored steps with no attempt as one attempt, with no earlier group', () => {
		renderSteps([{ title: 'One', description: 'A.' }]);

		expect(screen.queryByTestId('reasoning-earlier-attempt')).toBeNull();
	});

	it('puts the steps of an earlier attempt in a closed group named "Earlier attempt"', () => {
		renderSteps([
			{ title: 'Old', description: 'Before the fallback.', attempt: 1 },
			{ title: 'New', description: 'After the fallback.', attempt: 2 },
		]);

		const group = screen.getByTestId('reasoning-earlier-attempt');
		const trigger = within(group).getByRole('button', { name: /Earlier attempt/ });
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('Before the fallback.')).toBeNull();
		expect(screen.getByText('After the fallback.')).toBeTruthy();

		fireEvent.click(trigger);

		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(stepTitles(group)).toEqual(['Old']);
	});

	it('moves the steps shown so far into the group as soon as a new attempt starts', () => {
		renderSteps([{ title: 'Old', description: 'Before.', attempt: 1 }], { currentAttempt: 2 });

		expect(screen.getByTestId('reasoning-earlier-attempt')).toBeTruthy();
		expect(screen.queryByText('Before.')).toBeNull();
	});

	it("keeps an earlier attempt's sources with that attempt", () => {
		renderSteps(
			[
				{ title: 'Old', description: 'A.', attempt: 1 },
				{ title: 'New', description: 'B.', attempt: 2 },
			],
			{
				sources: [
					{ title: 'Old source', url: 'https://old.example', attempt: 1 },
					{ title: 'New source', url: 'https://new.example', attempt: 2 },
				],
			},
		);

		fireEvent.click(screen.getByRole('button', { name: /Earlier attempt/ }));
		const group = screen.getByTestId('reasoning-earlier-attempt');
		expect(within(group).getByText('Old source')).toBeTruthy();
		expect(within(group).queryByText('New source')).toBeNull();
	});
});

describe('ReasoningContent typing', () => {
	const streaming = (steps: Step[]) => (
		<Reasoning isStreaming reasoningSteps={steps}>
			<ReasoningContent reasoningSteps={steps} />
		</Reasoning>
	);
	const step = { title: 'Reading', description: 'Checked recent sentiment.' };

	afterEach(() => {
		vi.useRealTimers();
	});

	it('leaves no timer behind when unmounted before a new step starts typing', () => {
		vi.useFakeTimers();
		const { rerender, unmount } = render(streaming([]));
		// A new step schedules its typing on the next tick.
		rerender(streaming([step]));
		unmount();

		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('leaves no timer behind when unmounted while a step is typing', () => {
		vi.useFakeTimers();
		const { rerender, unmount } = render(streaming([]));
		rerender(streaming([step]));
		// The start tick and a few characters: the typing interval is running.
		vi.advanceTimersByTime(100);
		unmount();

		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('ReasoningContent while streaming', () => {
	const streaming = (steps: Step[], sources: Array<{ title: string; url: string }> = []) => (
		<Reasoning isStreaming defaultOpen reasoningSteps={steps}>
			<ReasoningContent reasoningSteps={steps} sources={sources} />
		</Reasoning>
	);
	const step = { title: 'Reading', description: 'Checked recent sentiment.' };

	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows a new step whole, with no typing, under reduced motion', () => {
		motion.reduced = true;
		vi.useFakeTimers();
		const { rerender } = render(streaming([]));

		rerender(streaming([step]));
		vi.advanceTimersByTime(0);

		expect(screen.getByText('Checked recent sentiment.')).toBeTruthy();
		expect(document.body.textContent).not.toContain('▍');
	});

	it('types a new step out when motion is not reduced', () => {
		vi.useFakeTimers();
		const { rerender } = render(streaming([]));

		rerender(streaming([step]));
		vi.advanceTimersByTime(0);

		expect(document.body.textContent).toContain('▍');
	});

	it('is not announced as it changes: the stored answer is what is announced', () => {
		render(streaming([step]));

		const content = screen.getByTestId('reasoning-step').closest('[aria-live]');
		expect(content?.getAttribute('aria-live')).toBe('off');
	});

	it('shows the same source sent twice twice, with no duplicate key', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const source = { title: 'CoinDesk', url: 'https://coindesk.com/a' };

		render(streaming([step], [source, source]));
		fireEvent.click(screen.getByText(/Used 2 sources/));

		expect(screen.getAllByText('CoinDesk')).toHaveLength(2);
		const keyWarnings = errors.mock.calls.filter(call => String(call[0]).includes('same key'));
		expect(keyWarnings).toEqual([]);
		errors.mockRestore();
	});
});

describe('ReasoningContent once the stored answer lands, or a run starts again', () => {
	const view = (steps: Step[], isStreaming: boolean) => (
		<Reasoning isStreaming={isStreaming} defaultOpen reasoningSteps={steps}>
			<ReasoningContent reasoningSteps={steps} />
		</Reasoning>
	);
	const descriptions = () =>
		screen.queryAllByTestId('reasoning-step').map(el => el.querySelector('p')?.textContent);

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([false, true])(
		'shows the stored descriptions, not the ones typed live, when they differ (reduced motion: %s)',
		reduced => {
			motion.reduced = reduced;
			vi.useFakeTimers();
			const liveZero = { title: 'Read', description: 'LIVE zero' };
			const liveOne = { title: 'Check', description: 'LIVE one' };
			const { rerender } = render(view([], true));
			rerender(view([liveZero], true));
			act(() => {
				vi.advanceTimersByTime(5_000);
			});
			rerender(view([liveZero, liveOne], true));
			act(() => {
				vi.advanceTimersByTime(5_000);
			});

			rerender(
				view(
					[
						{ title: 'Read', description: 'STORED zero' },
						{ title: 'Check', description: 'STORED one' },
					],
					false,
				),
			);
			act(() => {
				vi.advanceTimersByTime(5_000);
			});

			expect(descriptions()).toEqual(['STORED zero', 'STORED one']);
		},
	);

	it.each([false, true])(
		'shows nothing typed for an earlier run after a reset (reduced motion: %s)',
		reduced => {
			motion.reduced = reduced;
			vi.useFakeTimers();
			const { rerender } = render(view([], true));
			rerender(view([{ title: 'Old', description: 'OLD RUN text' }], true));
			act(() => {
				vi.advanceTimersByTime(5_000);
			});
			rerender(view([], true));

			rerender(
				view(
					[
						{ title: 'New', description: 'NEW zero' },
						{ title: 'Next', description: 'NEW one' },
					],
					true,
				),
			);
			act(() => {
				vi.advanceTimersByTime(5_000);
			});

			expect(descriptions()).toEqual(['NEW zero', 'NEW one']);
		},
	);

	it('shows a step whole once the next one arrives, though its typing had not finished', () => {
		vi.useFakeTimers();
		const { rerender } = render(view([], true));
		const first = { title: 'Read', description: 'A long description still being typed.' };
		rerender(view([first], true));
		act(() => {
			vi.advanceTimersByTime(100);
		});

		rerender(view([first, { title: 'Check', description: 'Next.' }], true));

		expect(descriptions()[0]).toBe('A long description still being typed.');
	});

	it('shows nothing typed for an earlier run when the reset and the new steps arrive together', () => {
		vi.useFakeTimers();
		const { rerender } = render(view([], true));
		rerender(view([{ title: 'Old', description: 'OLD RUN text' }], true));
		act(() => {
			vi.advanceTimersByTime(5_000);
		});

		rerender(
			view(
				[
					{ title: 'New', description: 'NEW zero' },
					{ title: 'Next', description: 'NEW one' },
				],
				true,
			),
		);
		act(() => {
			vi.advanceTimersByTime(5_000);
		});

		expect(descriptions()).toEqual(['NEW zero', 'NEW one']);
	});
});
