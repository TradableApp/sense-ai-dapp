import { cleanup, render, screen } from '@testing-library/react';
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
	render(
		<RenameConversationModal
			open
			onOpenChange={vi.fn()}
			onRenameSubmit={vi.fn()}
			isProcessing={false}
			error={error}
			conversationToRename={{ id: '1', title: 'Old title' }}
		/>,
	);
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

	it('disables Rename and says why while renames are switched off', () => {
		checkReturns('treasury-not-exempt');

		renderDialog();

		const rename = screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement;
		expect(rename.disabled).toBe(true);
		expect(screen.getByRole('dialog').textContent).toContain(
			feeTokenBlockCopy('treasury-not-exempt', 'PTS')?.title,
		);
	});
});
