import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useOneMetadataSend, { type MetadataMutateOptions } from './useOneMetadataSend';

type Call = [string, MetadataMutateOptions];

function setup() {
	const mutate = vi.fn<(_variables: string, _options: MetadataMutateOptions) => void>();
	const { result } = renderHook(() => useOneMetadataSend(mutate));
	const calls = () => mutate.mock.calls as Call[];
	return { mutate, send: (v: string, onSaved: () => Promise<undefined> = vi.fn(async () => undefined)) =>
			result.current(v, onSaved), calls };
}

// A rename or delete is paid: a second press before the first is saved must not pay again.
describe('a rename or delete pressed twice', () => {
	it('is sent once', () => {
		const { mutate, send } = setup();

		send('first');
		send('second');

		expect(mutate).toHaveBeenCalledTimes(1);
		expect(mutate.mock.calls[0][0]).toBe('first');
	});

	it('can be sent again once the first is saved here', async () => {
		const { mutate, send, calls } = setup();
		send('first');

		await act(async () => {
			await calls()[0][1].onSuccess();
		});
		send('second');

		expect(mutate).toHaveBeenCalledTimes(2);
	});

	// The local save after the receipt is part of the send: until it ends, it is still in flight.
	it('is still in flight while the local save runs', async () => {
		const { mutate, send, calls } = setup();
		let finishSave = () => undefined as void;
		send(
			'first',
			() =>
				new Promise<undefined>(resolve => {
					finishSave = () => resolve(undefined);
				}),
		);

		const saving = calls()[0][1].onSuccess();
		send('second');
		expect(mutate).toHaveBeenCalledTimes(1);

		finishSave();
		await act(async () => {
			await saving;
		});
		send('third');
		expect(mutate).toHaveBeenCalledTimes(2);
	});

	it('can be sent again after the first failed', () => {
		const { mutate, send, calls } = setup();
		send('first');

		act(() => calls()[0][1].onError());
		send('second');

		expect(mutate).toHaveBeenCalledTimes(2);
	});
});
