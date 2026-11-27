import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { switchedOffReason } from '@/lib/paymentGate';
import { DISAGREEING_STATES } from '@/test/feeTokenVerdicts';

import DeleteConversationDialog from './DeleteConversationDialog';

// The prompts switch stays open here; its own tests close it.
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: () => ({ status: 'open' }) }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
// The oracle key check has no answer here, so it stops nothing; its own tests drive it.
vi.mock('@/hooks/useOracleKeyCheck', () => ({ default: () => 'unknown' }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

function renderDialog() {
	const onConfirm = vi.fn();
	const onOpenChange = vi.fn();
	render(
		<DeleteConversationDialog
			open
			onOpenChange={onOpenChange}
			onConfirm={onConfirm}
			onCancel={vi.fn()}
			isProcessing={false}
		/>,
	);
	return { onConfirm, onOpenChange };
}

const continueButton = () => screen.getByRole('button', { name: /continue/i });

afterEach(cleanup);

// Deletes pay a fee, so every disagreement switches them off (see blocksAction).
const switchedOff = DISAGREEING_STATES.filter(verdict => blocksAction(verdict, 'metadata'));

describe('DeleteConversationDialog', () => {
	it('deletes when deletes are allowed, with no banner', () => {
		checkReturns('ok');
		const { onConfirm } = renderDialog();

		expect(screen.queryByRole('alert')).toBeNull();
		expect(continueButton().getAttribute('aria-disabled')).not.toBe('true');
		fireEvent.click(continueButton());

		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it.each(switchedOff)('shows the banner itself under %s', verdict => {
		checkReturns(verdict);
		renderDialog();

		const copy = feeTokenBlockCopy(verdict, 'PTS');
		expect(screen.getByRole('alert').textContent).toContain(copy?.title);
	});

	it.each(switchedOff)(
		'under %s keeps Continue focusable, marks it switched off with the reason, and sends nothing',
		verdict => {
			checkReturns(verdict);
			const { onConfirm, onOpenChange } = renderDialog();

			const button = continueButton();
			expect(button.getAttribute('aria-disabled')).toBe('true');
			expect((button as HTMLButtonElement).disabled).toBe(false);
			const describedBy = button.getAttribute('aria-describedby') ?? '';
			expect(describedBy).not.toBe('');
			expect(document.getElementById(describedBy)?.textContent).toBe(
				switchedOffReason(
					{ feeToken: verdict, prompts: { status: 'open' }, oracleKey: 'unknown' },
					'metadata',
					'PTS',
					'dialog',
				),
			);

			button.focus();
			expect(document.activeElement).toBe(button);
			fireEvent.click(button);

			expect(onConfirm).not.toHaveBeenCalled();
			expect(onOpenChange).not.toHaveBeenCalledWith(false);
		},
	);
});
