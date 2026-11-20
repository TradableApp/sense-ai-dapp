import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/** Switched off, but still in the Tab order: aria-disabled, not the native attribute. */
const isSwitchedOff = (element: HTMLButtonElement) =>
	element.getAttribute('aria-disabled') === 'true' && !element.disabled;

/** Tries every way a user activates a button: a click, Enter and Space. */
function activate(element: HTMLElement) {
	act(() => {
		fireEvent.pointerDown(element, { button: 0, ctrlKey: false, pointerType: 'mouse' });
		fireEvent.click(element);
		fireEvent.keyDown(element, { key: 'Enter' });
		fireEvent.keyDown(element, { key: ' ' });
	});
}

/** The text of the tooltip that is open, if any. */
const tooltipText = () =>
	screen
		.queryAllByRole('tooltip')
		.map(tip => tip.textContent)
		.join(' ');

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

			expect(isSwitchedOff(button(name))).toBe(true);
			expect(description(button(name))).toContain(feeTokenBlockCopy(verdict, 'PTS')?.title);
		},
	);

	it.each(cases.filter(c => !blocksAction(c.verdict, c.pays)))(
		'$name stays on under $verdict',
		({ name, verdict }) => {
			checkReturns(verdict);

			render(<MessageActions message={answer} />);

			expect(button(name).disabled).toBe(false);
			expect(button(name).getAttribute('aria-disabled')).not.toBe('true');
		},
	);

	it.each(ANSWER_CONTROLS)(
		'$name, switched off, opens nothing however it is activated',
		({ name }) => {
			checkReturns('escrow-not-exempt');
			render(<MessageActions message={answer} />);

			activate(button(name));

			expect(screen.queryAllByRole('menuitem')).toEqual([]);
		},
	);

	it.each(ANSWER_CONTROLS)('$name, switched off, shows why when it takes the focus', ({ name }) => {
		checkReturns('escrow-not-exempt');
		render(<MessageActions message={answer} />);

		act(() => {
			button(name).focus();
		});

		expect(document.activeElement).toBe(button(name));
		expect(tooltipText()).toContain(feeTokenBlockCopy('escrow-not-exempt', 'PTS')?.title);
	});

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

			expect(isSwitchedOff(button('Edit message'))).toBe(true);
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
			expect(button('Edit message').getAttribute('aria-disabled')).not.toBe('true');
		},
	);

	it('switched off, starts no edit however it is activated, and shows why on focus', () => {
		checkReturns('symbol-mismatch');
		const onEdit = vi.fn();
		render(<UserMessageActions message={prompt} onEdit={onEdit} />);

		activate(button('Edit message'));
		act(() => {
			button('Edit message').focus();
		});

		expect(onEdit).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button('Edit message'));
		expect(tooltipText()).toContain(feeTokenBlockCopy('symbol-mismatch', 'PTS')?.title);
	});
});
