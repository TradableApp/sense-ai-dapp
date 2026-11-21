import { useState } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { blocksAction, feeTokenBlockCopy, type FeeTokenCheckState } from '@/lib/feeTokenCheck';
import { FEE_TOKEN_STATES } from '@/test/feeTokenVerdicts';

import EditPromptInput from './edit-prompt-input';

// The prompts switch stays open here; its own tests close it.
vi.mock('@/hooks/usePromptsSwitch', () => ({ default: () => ({ status: 'open' }) }));
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

/** Stands in for the chat: a save starts a send, and the editor is told it is sending. */
function EditorWhoseSaveStartsASend({ onSave }: { onSave: (_data: { content: string }) => void }) {
	const [isSending, setIsSending] = useState(false);
	return (
		<EditPromptInput
			originalContent="A prompt"
			isSending={isSending}
			onSave={data => {
				onSave(data);
				setIsSending(true);
			}}
			onCancel={vi.fn()}
		/>
	);
}

function renderSendingEditor() {
	checkReturns('ok');
	const onSave = vi.fn();
	render(<EditorWhoseSaveStartsASend onSave={onSave} />);
	return {
		onSave,
		save: () => screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement,
	};
}

describe('saving an edited prompt while it is being sent', () => {
	it('sends once when Save is pressed twice', async () => {
		const { onSave, save } = renderSendingEditor();
		// Save is enabled once the form has checked the text it starts with.
		await waitFor(() => expect(save().disabled).toBe(false));

		await act(async () => {
			fireEvent.click(save());
		});
		const afterFirstPress = onSave.mock.calls.length;
		await act(async () => {
			fireEvent.click(save());
		});

		expect(afterFirstPress).toBe(1);
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('sends once when Enter is pressed twice', async () => {
		const { onSave } = renderSendingEditor();

		await act(async () => {
			fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
		});
		await act(async () => {
			fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
		});

		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('disables Save and says that a prompt is being sent', async () => {
		const { save } = renderSendingEditor();

		await act(async () => {
			fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
		});

		expect(save().disabled).toBe(true);
		expect(description(save())).toMatch(/being sent/i);
	});
});

describe('saving an edited prompt while its conversation holds an unsaved paid send', () => {
	it('is disabled, says why, and Enter sends nothing', async () => {
		checkReturns('ok');
		const onSave = vi.fn();
		render(
			<EditPromptInput
				originalContent="A prompt"
				onSave={onSave}
				onCancel={vi.fn()}
				heldReason="Held for now."
			/>,
		);
		const save = screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement;

		await act(async () => {
			fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
		});

		expect(save.disabled).toBe(true);
		expect(description(save)).toBe('Held for now.');
		expect(onSave).not.toHaveBeenCalled();
	});
});
