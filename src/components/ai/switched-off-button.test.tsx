import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SwitchedOffButton from './switched-off-button';

afterEach(cleanup);

describe('SwitchedOffButton', () => {
	it('keeps its click from reaching a clickable parent', () => {
		const parentClicked = vi.fn();
		render(
			// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
			<div onClick={parentClicked}>
				<SwitchedOffButton label="Edit message" reason="Payments are switched off.">
					<span>icon</span>
				</SwitchedOffButton>
			</div>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

		expect(parentClicked).not.toHaveBeenCalled();
	});
});
