import { createElement, type ReactNode } from 'react';

import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useOneMetadataSend, {
	METADATA_SEND_KEY,
	type MetadataMutateOptions,
} from './useOneMetadataSend';

/** A send the test settles by hand: `confirm` or `fail` the latest one. */
function chainSends() {
	const settles: { confirm: () => void; fail: () => void }[] = [];
	const send = vi.fn(
		(_variables: string) =>
			new Promise<void>((resolve, reject) => {
				settles.push({ confirm: () => resolve(), fail: () => reject(new Error('reverted')) });
			}),
	);
	return { send, latest: () => settles[settles.length - 1] };
}

/** History's sender as it is wired: the mutation declared with the key, then the lock. */
function useSender(send: (_variables: string) => Promise<void>) {
	const mutation = useMutation({ mutationKey: METADATA_SEND_KEY, mutationFn: send });
	return useOneMetadataSend<string>(
		mutation.mutate as (_variables: string, _options: MetadataMutateOptions) => void,
	);
}

function setup(queryClient = new QueryClient()) {
	const chain = chainSends();
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
	const mount = () => renderHook(() => useSender(chain.send), { wrapper });
	const first = mount();
	const press = (
		rendered: ReturnType<typeof mount>,
		variables: string,
		onSaved: () => Promise<void> = async () => undefined,
	) => act(() => rendered.result.current(variables, onSaved));
	return { ...chain, queryClient, mount, first, press };
}

// A rename or delete is paid: a second press before the first is saved must not pay again.
describe('a rename or delete pressed twice', () => {
	it('is sent once', async () => {
		const { send, first, press } = setup();

		press(first, 'first');
		press(first, 'second');

		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toBe('first');
	});

	it('in the same moment is sent once', async () => {
		const { send, first } = setup();

		act(() => {
			first.result.current('first', async () => undefined);
			first.result.current('second', async () => undefined);
		});

		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(send.mock.calls[0][0]).toBe('first');
	});

	it('can be sent again once the first is saved here', async () => {
		const { send, first, press, latest, queryClient } = setup();
		press(first, 'first');
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

		await act(async () => latest().confirm());
		await waitFor(() => expect(queryClient.isMutating()).toBe(0));
		press(first, 'second');

		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	});

	// The local save after the receipt is part of the send: until it ends, it is still in flight.
	it('is still in flight while the local save runs', async () => {
		const { send, first, press, latest, queryClient } = setup();
		let finishSave = () => undefined as void;
		const saving = new Promise<void>(resolve => {
			finishSave = resolve;
		});
		press(first, 'first', () => saving);
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		await act(async () => latest().confirm());
		await waitFor(() => expect(queryClient.isMutating()).toBe(0));

		press(first, 'second');
		expect(send).toHaveBeenCalledTimes(1);

		await act(async () => finishSave());
		press(first, 'third');
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	});

	it('can be sent again after the first failed', async () => {
		const { send, first, press, latest, queryClient } = setup();
		press(first, 'first');
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

		await act(async () => latest().fail());
		await waitFor(() => expect(queryClient.isMutating()).toBe(0));
		press(first, 'second');

		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	});
});

// The lock is read from the query client, as the paid-send lock is: leaving the history and
// coming back mid-send must not give a fresh lock that lets the same change be paid again.
describe('a rename or delete sent when the history is left and opened again', () => {
	it('still refuses a second send while the first is pending', async () => {
		const { send, first, mount, press } = setup();
		press(first, 'first');
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		first.unmount();

		const reopened = mount();
		press(reopened, 'second');

		await act(async () => undefined);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('still refuses while the first is being saved here', async () => {
		const { send, first, mount, press, latest, queryClient } = setup();
		const saving = new Promise<void>(() => {
			// Never settles, as a save blocked by another tab.
		});
		press(first, 'first', () => saving);
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		await act(async () => latest().confirm());
		await waitFor(() => expect(queryClient.isMutating()).toBe(0));
		first.unmount();

		const reopened = mount();
		press(reopened, 'second');

		await act(async () => undefined);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('sends once the first has settled', async () => {
		const { send, first, mount, press, latest, queryClient } = setup();
		press(first, 'first');
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		first.unmount();
		await act(async () => latest().confirm());
		await waitFor(() => expect(queryClient.isMutating()).toBe(0));

		const reopened = mount();
		press(reopened, 'second');

		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	});
});
