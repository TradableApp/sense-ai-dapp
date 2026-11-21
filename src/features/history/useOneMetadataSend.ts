import { useCallback } from 'react';

import { type QueryClient, useQueryClient } from '@tanstack/react-query';

/** The key the rename and delete mutation is declared with (`useChatMutations`). */
export const METADATA_SEND_KEY = ['metadata-send'];

/** The callbacks a rename or delete is sent with. */
export interface MetadataMutateOptions {
	onSuccess: () => Promise<void>;
}

/**
 * How many confirmed renames and deletes are still being saved here, kept per query client
 * rather than per mounted history: the history left and opened again while a save runs must
 * still refuse.
 */
const savingByClient = new WeakMap<QueryClient, { count: number }>();

function savingFor(queryClient: QueryClient): { count: number } {
	const known = savingByClient.get(queryClient);
	if (known) return known;
	const saving = { count: 0 };
	savingByClient.set(queryClient, saving);
	return saving;
}

function changeSaving(saving: { count: number }, change: 1 | -1): void {
	// A counter kept per query client, changed in place.
	// eslint-disable-next-line no-param-reassign
	saving.count += change;
}

/**
 * Sends a rename or delete (both paid) one at a time: a second press while one is in flight
 * does nothing, as the paid-send lock does for prompts. In flight is read from the query
 * client, not from the component: the mutation is pending in its cache under
 * `METADATA_SEND_KEY` from the moment it starts (so a second press in the same moment is
 * refused, and so is one after the history was left and opened again), and the local save
 * after the receipt (`onSaved`) is counted per query client until it ends. The library runs
 * `onSaved` only while the history that sent it is open; left before the receipt, the change
 * comes back through the sync.
 */
export default function useOneMetadataSend<V>(
	mutate: (_variables: V, _options: MetadataMutateOptions) => void,
) {
	const queryClient = useQueryClient();
	return useCallback(
		(variables: V, onSaved: () => Promise<void>) => {
			const saving = savingFor(queryClient);
			if (queryClient.isMutating({ mutationKey: METADATA_SEND_KEY }) > 0 || saving.count > 0) {
				return;
			}
			mutate(variables, {
				onSuccess: async () => {
					changeSaving(saving, 1);
					try {
						await onSaved();
					} finally {
						changeSaving(saving, -1);
					}
				},
			});
		},
		[mutate, queryClient],
	);
}
