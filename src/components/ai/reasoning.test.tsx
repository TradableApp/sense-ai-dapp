import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Reasoning, ReasoningContent } from './reasoning';

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

afterEach(cleanup);

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
