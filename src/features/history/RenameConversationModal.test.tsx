import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import {
	blocksAction,
	feeTokenBlockCopy,
	FeeTokenBlockedError,
	type FeeTokenCheckState,
} from '@/lib/feeTokenCheck';

import RenameConversationModal from './RenameConversationModal';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

function renderDialog(error: Error | null = null) {
	const onRenameSubmit = vi.fn();
	render(
		<RenameConversationModal
			open
			onOpenChange={vi.fn()}
			onRenameSubmit={onRenameSubmit}
			isProcessing={false}
			error={error}
			conversationToRename={{ id: '1', title: 'Old title' }}
		/>,
	);
	return onRenameSubmit;
}

const renameButton = () => screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement;

/** Types a valid new title and lets the form validate it. */
async function typeValidTitle() {
	const input = screen.getByPlaceholderText('Conversation title');
	await act(async () => {
		fireEvent.change(input, { target: { value: 'A new title' } });
	});
	return input.closest('form') as HTMLFormElement;
}

afterEach(cleanup);

describe('RenameConversationModal', () => {
	it('shows the banner words, not a developer message, when the rename was switched off', () => {
		checkReturns('ok');
		const error = new FeeTokenBlockedError('escrow-not-exempt', 'PTS');

		renderDialog(error);

		const copy = feeTokenBlockCopy('escrow-not-exempt', 'PTS');
		expect(screen.getByRole('dialog').textContent).toContain(copy?.description);
		expect(screen.getByRole('dialog').textContent).not.toMatch(/fee token check/i);
	});

	it('enables Rename for a valid title while renames are allowed', async () => {
		checkReturns('ok');
		renderDialog();

		await typeValidTitle();

		await waitFor(() => expect(renameButton().disabled).toBe(false));
	});

	it('keeps Rename disabled for a valid title while renames are switched off, and says why', async () => {
		checkReturns('treasury-not-exempt');
		renderDialog();

		await typeValidTitle();

		const title = feeTokenBlockCopy('treasury-not-exempt', 'PTS')?.title ?? '';
		expect(renameButton().disabled).toBe(true);
		expect(screen.getByRole('dialog').textContent).toContain(title);
	});

	it('names the reason as the description of Rename', async () => {
		checkReturns('treasury-not-exempt');
		renderDialog();

		await typeValidTitle();

		const ids = (renameButton().getAttribute('aria-describedby') ?? '').split(' ');
		const described = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ');
		expect(described).toContain(feeTokenBlockCopy('treasury-not-exempt', 'PTS')?.title);
	});

	it('sends nothing when the form is submitted while renames are switched off', async () => {
		checkReturns('escrow-not-exempt');
		const onRenameSubmit = renderDialog();

		const form = await typeValidTitle();
		await act(async () => {
			fireEvent.submit(form);
		});

		expect(onRenameSubmit).not.toHaveBeenCalled();
	});

	// The dialog's backdrop hides the notice at the top of the page, so the dialog carries it.
	it('shows the banner title and description inside the dialog while renames are switched off', () => {
		checkReturns('treasury-not-exempt');

		renderDialog();

		const copy = feeTokenBlockCopy('treasury-not-exempt', 'PTS');
		const dialog = screen.getByRole('dialog');
		expect(within(dialog).queryByRole('alert')).not.toBeNull();
		expect(dialog.textContent).toContain(copy?.title);
		expect(dialog.textContent).toContain(copy?.description);
	});

	it('points at the notice the user can see, not at the page behind the dialog', async () => {
		checkReturns('escrow-not-exempt');
		renderDialog();

		await typeValidTitle();

		const ids = (renameButton().getAttribute('aria-describedby') ?? '').split(' ');
		const described = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ');
		expect(described).not.toMatch(/top of the page/i);
		expect(described).toContain(feeTokenBlockCopy('escrow-not-exempt', 'PTS')?.title);
	});

	it.each(['ok', 'unknown'] as const)('shows no banner under %s', verdict => {
		checkReturns(verdict);

		renderDialog();

		expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
		expect(screen.getByRole('dialog').textContent).not.toMatch(/switched off/i);
	});
});
