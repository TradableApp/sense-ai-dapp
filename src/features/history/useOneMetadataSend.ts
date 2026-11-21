import { useCallback, useRef } from 'react';

/** The callbacks a rename or delete is sent with. */
export interface MetadataMutateOptions {
	onSuccess: () => Promise<void>;
	onError: () => void;
}

/**
 * Sends a rename or delete (both paid) one at a time: a second press while one is in flight
 * does nothing, as the paid-send lock does for prompts. In flight lasts until the local save
 * after the receipt (`onSaved`) has ended, or the send has failed: only then can the dialog
 * have closed or shown the error. A ref, not state: a second press can come before a render.
 */
export default function useOneMetadataSend<V>(
	mutate: (_variables: V, _options: MetadataMutateOptions) => void,
) {
	const inFlight = useRef(false);
	return useCallback(
		(variables: V, onSaved: () => Promise<void>) => {
			if (inFlight.current) return;
			inFlight.current = true;
			const release = () => {
				inFlight.current = false;
			};
			mutate(variables, {
				onSuccess: async () => {
					try {
						await onSaved();
					} finally {
						release();
					}
				},
				onError: release,
			});
		},
		[mutate],
	);
}
