import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import EditPromptInput from './edit-prompt-input';

vi.mock('@/hooks/useFeeTokenCheck', () => ({ default: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));

const checkReturns = (verdict: FeeTokenCheckState) =>
	vi.mocked(useFeeTokenCheck).mockReturnValue({
		verdict,
		blocks: action => blocksAction(verdict, action),
	});

function renderEditor() {
	const onSave = vi.fn();
	render(<EditPromptInput originalContent="A prompt" onSave={onSave} onCancel={vi.fn()} />);
	return { onSave, save: screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement };
}

const description = (element: HTMLElement) =>
	(element.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
		.trim();

afterEach(cleanup);

describe('saving an edited prompt', () => {
	it.each(FEE_TOKEN_STATES.filter(state => blocksAction(state, 'prompt')))(
		'is disabled under %s, says why, and Enter sends nothing',
		async verdict => {
			checkReturns(verdict);
			const { onSave, save } = renderEditor();

			await act(async () => {
				fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
			});

			expect(save.disabled).toBe(true);
			expect(description(save)).toContain(feeTokenBlockCopy(verdict, 'PTS')?.title);
			expect(onSave).not.toHaveBeenCalled();
		},
	);

	it('is sent with Enter while prompts are allowed', async () => {
		checkReturns('treasury-not-exempt');
		const { onSave } = renderEditor();

		await act(async () => {
			fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
		});

		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
