import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import MessageActions from './message-actions';
import UserMessageActions from './user-message-actions';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ ownerAddress: '0xaa' }),
}));
vi.mock('@/lib/feedbackService', () => ({ default: vi.fn() }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const description = (element: HTMLElement) =>
	(element.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
		.trim();

const answer = { id: 3, role: 'assistant', content: 'An answer', conversationId: '1', parentId: 2 };
const prompt = { id: 2, role: 'user', content: 'A prompt' };

afterEach(cleanup);

// Each control and the action it pays for. "More actions" holds only the branch.
const ANSWER_CONTROLS = [
	{ name: 'Try again', pays: 'prompt' },
	{ name: 'More actions', pays: 'branch' },
] as const;

describe('the controls on an answer', () => {
	const cases = ANSWER_CONTROLS.flatMap(control =>
		FEE_TOKEN_STATES.map(verdict => ({ ...control, verdict })),
	);

	it.each(cases.filter(c => blocksAction(c.verdict, c.pays)))(
		'$name is disabled under $verdict and says why',
		({ name, verdict }) => {
			checkReturns(verdict);

			render(<MessageActions message={answer} />);

			expect(button(name).disabled).toBe(true);
			expect(description(button(name))).toContain(feeTokenBlockCopy(verdict, 'PTS')?.title);
		},
	);

	it.each(cases.filter(c => !blocksAction(c.verdict, c.pays)))(
		'$name stays on under $verdict',
		({ name, verdict }) => {
			checkReturns(verdict);

			render(<MessageActions message={answer} />);

			expect(button(name).disabled).toBe(false);
		},
	);

	it('copy and feedback stay on while everything is switched off', () => {
		checkReturns('escrow-not-exempt');

		render(<MessageActions message={answer} />);

		expect(button('Copy').disabled).toBe(false);
		expect(button('Good response').disabled).toBe(false);
	});
});

describe('the edit control on a prompt', () => {
	it.each(FEE_TOKEN_STATES.filter(state => blocksAction(state, 'prompt')))(
		'is disabled under %s and says why',
		verdict => {
			checkReturns(verdict);

			render(<UserMessageActions message={prompt} />);

			expect(button('Edit message').disabled).toBe(true);
			expect(description(button('Edit message'))).toContain(
				feeTokenBlockCopy(verdict, 'PTS')?.title,
			);
		},
	);

	it.each(FEE_TOKEN_STATES.filter(state => !blocksAction(state, 'prompt')))(
		'stays on under %s',
		verdict => {
			checkReturns(verdict);

			render(<UserMessageActions message={prompt} />);

			expect(button('Edit message').disabled).toBe(false);
		},
	);
});
