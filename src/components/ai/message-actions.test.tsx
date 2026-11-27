import { useState } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNSAVED_SEND_REASON } from '@/components/ai/sendingReason';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { switchCopy } from '@/lib/promptsSwitch';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import MessageActions from './message-actions';
import UserMessageActions from './user-message-actions';

vi.mock('@/hooks/usePromptsSwitch', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
// The oracle key check has no answer here, so it stops nothing; its own tests drive it.
vi.mock('@/hooks/useOracleKeyCheck', () => ({ default: () => 'unknown' }));
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

beforeEach(() => {
	vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'open' });
});

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

describe('the "More actions" menu', () => {
	it('holds only the branch, because switching branching off disables the whole trigger', () => {
		checkReturns('ok');
		render(<MessageActions message={answer} />);

		act(() => {
			fireEvent.pointerDown(button('More actions'), {
				button: 0,
				ctrlKey: false,
				pointerType: 'mouse',
			});
		});

		const items = screen.getAllByRole('menuitem').map(item => item.textContent?.trim());
		expect(items).toEqual(['Branch in new chat']);
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

		act(() => {
			button('Edit message').focus();
		});
		const shownOnFocus = tooltipText();
		activate(button('Edit message'));

		expect(onEdit).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button('Edit message'));
		expect(shownOnFocus).toContain(feeTokenBlockCopy('symbol-mismatch', 'PTS')?.title);
	});
});

/** Stands in for the chat: choosing regenerate or branch starts a send, and the answer is told. */
function AnswerWhoseActionsStartASend({
	onRegenerate,
	onBranch,
}: {
	onRegenerate: (_mode?: string) => void;
	onBranch: () => void;
}) {
	const [isSending, setIsSending] = useState(false);
	return (
		<MessageActions
			message={answer}
			isSending={isSending}
			onRegenerate={mode => {
				onRegenerate(mode);
				setIsSending(true);
			}}
			onBranch={() => {
				onBranch();
				setIsSending(true);
			}}
		/>
	);
}

/** Opens a menu as a pointer does and chooses an item, if the menu opened. */
function choose(trigger: string, item: string) {
	act(() => {
		fireEvent.pointerDown(button(trigger), { button: 0, ctrlKey: false, pointerType: 'mouse' });
	});
	const entry = screen.queryByRole('menuitem', { name: item });
	if (entry) {
		act(() => {
			fireEvent.click(entry);
		});
	}
}

const SENDING_CONTROLS = [
	{ trigger: 'Try again', item: 'Try again', calls: 'onRegenerate' },
	{ trigger: 'More actions', item: 'Branch in new chat', calls: 'onBranch' },
] as const;

describe('the controls on an answer while a prompt is being sent', () => {
	it.each(SENDING_CONTROLS)('$item chosen twice starts one send', ({ trigger, item, calls }) => {
		checkReturns('ok');
		const handlers = { onRegenerate: vi.fn(), onBranch: vi.fn() };
		render(<AnswerWhoseActionsStartASend {...handlers} />);

		choose(trigger, item);
		choose(trigger, item);

		expect(handlers[calls]).toHaveBeenCalledTimes(1);
	});

	it.each(SENDING_CONTROLS)(
		'$trigger is switched off and says a prompt is being sent',
		({ trigger, item }) => {
			checkReturns('ok');
			render(<AnswerWhoseActionsStartASend onRegenerate={vi.fn()} onBranch={vi.fn()} />);

			choose(trigger, item);

			expect(isSwitchedOff(button(trigger))).toBe(true);
			expect(description(button(trigger))).toMatch(/being sent/i);
		},
	);
});

describe('the controls on an answer while prompts are closed by the switch', () => {
	it.each(ANSWER_CONTROLS)(
		'$name is switched off with the switch title as its reason',
		({ name }) => {
			checkReturns('ok');
			vi.mocked(usePromptsSwitch).mockReturnValue({ status: 'closed', wording: 'incident' });

			render(<MessageActions message={answer} />);

			expect(isSwitchedOff(button(name))).toBe(true);
			expect(description(button(name))).toContain(switchCopy('incident').title);
		},
	);

	it.each(ANSWER_CONTROLS)('$name is on again once the switch is open', ({ name }) => {
		checkReturns('ok');

		render(<MessageActions message={answer} />);

		expect(button(name).getAttribute('aria-disabled')).not.toBe('true');
	});
});

describe('the controls on an answer whose paid send was not saved here', () => {
	it.each(ANSWER_CONTROLS)('$name is switched off and says why', ({ name }) => {
		checkReturns('ok');

		render(<MessageActions message={answer} heldReason={UNSAVED_SEND_REASON} />);

		expect(isSwitchedOff(button(name))).toBe(true);
		expect(description(button(name))).toBe(UNSAVED_SEND_REASON);
	});

	it.each(ANSWER_CONTROLS)('$name is on with no reason given', ({ name }) => {
		checkReturns('ok');

		render(<MessageActions message={answer} heldReason={null} />);

		expect(button(name).getAttribute('aria-disabled')).not.toBe('true');
	});
});

describe('the edit control on a prompt whose conversation holds an unsaved paid send', () => {
	// Saving an edit sends a paid prompt: resent while the first is not shown, it is paid twice.
	it('is switched off, starts no edit and says why', () => {
		checkReturns('ok');
		const onEdit = vi.fn();
		render(<UserMessageActions message={prompt} onEdit={onEdit} heldReason="Held for now." />);

		activate(button('Edit message'));

		expect(isSwitchedOff(button('Edit message'))).toBe(true);
		expect(description(button('Edit message'))).toBe('Held for now.');
		expect(onEdit).not.toHaveBeenCalled();
	});

	it('is on with no reason given', () => {
		checkReturns('ok');

		render(<UserMessageActions message={prompt} heldReason={null} />);

		expect(button('Edit message').getAttribute('aria-disabled')).not.toBe('true');
	});
});

describe('the status under a prompt', () => {
	// The prompt is on chain and waiting for its answer: "Sending" would say it is not sent.
	it('says a pending prompt is awaiting its answer, not sending', () => {
		checkReturns('ok');

		render(<UserMessageActions message={{ ...prompt, status: 'pending' }} />);

		expect(screen.getByText('Awaiting answer')).toBeTruthy();
		expect(screen.queryByText(/Sending/)).toBeNull();
	});
});
