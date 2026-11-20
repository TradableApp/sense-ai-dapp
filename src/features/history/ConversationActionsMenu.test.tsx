import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import ConversationActionsMenu from './ConversationActionsMenu';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

function openMenu(props: Partial<Parameters<typeof ConversationActionsMenu>[0]> = {}) {
	const onRename = vi.fn();
	const onDelete = vi.fn();
	render(
		<ConversationActionsMenu
			isSessionReady
			hasActivePlan
			hasPendingPrompts={false}
			onRename={onRename}
			onDelete={onDelete}
			{...props}
		/>,
	);
	const trigger = screen.getByRole('button', { name: 'Toggle menu' });
	act(() => {
		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
	});
	return { onRename, onDelete };
}

const item = (name: string) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true';
const description = (element: HTMLElement) =>
	(element.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
		.trim();

afterEach(cleanup);

describe('ConversationActionsMenu while renames and deletes are switched off', () => {
	const switchedOff = FEE_TOKEN_STATES.filter(state => blocksAction(state, 'metadata'));

	it.each(switchedOff)('disables rename and delete under %s and says why', verdict => {
		checkReturns(verdict);

		openMenu();

		const title = feeTokenBlockCopy(verdict, 'PTS')?.title ?? '';
		['Rename', 'Delete'].forEach(name => {
			expect(isDisabled(item(name)), name).toBe(true);
			expect(description(item(name)), name).toContain(title);
		});
	});

	it('does not start a rename or a delete when the item is clicked anyway', () => {
		checkReturns('escrow-not-exempt');
		const { onRename, onDelete } = openMenu();
		const rename = item('Rename');
		const remove = item('Delete');

		fireEvent.click(rename);
		fireEvent.click(remove);

		expect(onRename).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();
	});
});

describe('ConversationActionsMenu, switched off, by keyboard', () => {
	it('can still reach rename and delete with the arrow keys', async () => {
		checkReturns('escrow-not-exempt');
		openMenu();
		const menu = screen.getByRole('menu');

		act(() => {
			fireEvent.keyDown(menu, { key: 'ArrowDown' });
		});
		const first = document.activeElement;
		act(() => {
			fireEvent.keyDown(item('Rename'), { key: 'ArrowDown' });
		});

		// Radix moves the focus between items on the next tick.
		await waitFor(() => expect(document.activeElement).toBe(item('Delete')));
		expect(first).toBe(item('Rename'));
	});

	it('does nothing on Enter or Space, and the menu stays open', () => {
		checkReturns('escrow-not-exempt');
		const { onRename, onDelete } = openMenu();

		['Rename', 'Delete'].forEach(name => {
			act(() => {
				fireEvent.keyDown(item(name), { key: 'Enter' });
				fireEvent.keyDown(item(name), { key: ' ' });
			});
		});

		expect(onRename).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();
		expect(screen.queryByRole('menu')).not.toBeNull();
	});

	it('shows why when an item takes the focus', () => {
		checkReturns('escrow-not-exempt');
		openMenu();

		act(() => {
			item('Rename').focus();
		});

		const tips = screen.queryAllByRole('tooltip').map(tip => tip.textContent);
		expect(document.activeElement).toBe(item('Rename'));
		expect(tips.join(' ')).toContain(feeTokenBlockCopy('escrow-not-exempt', 'PTS')?.title);
	});
});

describe('ConversationActionsMenu while renames and deletes are allowed', () => {
	it.each(FEE_TOKEN_STATES.filter(state => !blocksAction(state, 'metadata')))(
		'leaves rename and delete on under %s',
		verdict => {
			checkReturns(verdict);

			openMenu();

			expect(isDisabled(item('Rename'))).toBe(false);
			expect(isDisabled(item('Delete'))).toBe(false);
		},
	);

	it('still says why delete is off while a prompt is pending', () => {
		checkReturns('ok');

		openMenu({ hasPendingPrompts: true });

		expect(isDisabled(item('Delete'))).toBe(true);
		expect(description(item('Delete'))).toMatch(/pending/i);
	});
});
