import { useEffect, useRef } from 'react';

import type { DocumentSnapshot, Query } from 'firebase/firestore';
import { onSnapshot } from 'firebase/firestore';

import { dataFromSnapshot } from '@/lib/firestoreService';
import { asyncActionError, asyncActionFinish, asyncActionStart } from '@/store/asyncSlice';
import { useAppDispatch } from '@/store/hooks';

import useCompare from './useCompare';

interface FirestoreDocumentListenerProps {
	queryFn: () => DocumentSnapshot | Query;
	queryDeps: (string | number | null | undefined)[] | null;
	docFn?: (doc: any) => any;
	docId?: string;
	dataFn: (data: any) => void;
	errorFn?: () => void;
	deps: unknown[];
	shouldExecute?: boolean;
	loadingTag?: string;
}

export default function useFirestoreDocumentListener({
	queryFn,
	queryDeps,
	docFn,
	docId,
	dataFn,
	errorFn,
	deps,
	shouldExecute = true,
	loadingTag = 'useFirestoreDocumentListener',
}: FirestoreDocumentListenerProps) {
	// Redux Dispatch
	const dispatch = useAppDispatch();

	// Previous state/ prop values for comparison
	const queryDepsCompare = useCompare(queryDeps);

	// Set isMounted ref
	const isMounted = useRef(false);

	useEffect(() => {
		if (!shouldExecute) return null;

		if (queryDepsCompare && isMounted.current) {
			dataFn({});
		}

		if (!queryDeps || queryDeps.length === 0 || queryDeps.every(dep => !!dep)) {
			dispatch(asyncActionStart(loadingTag));

			const unsubscribe = onSnapshot(
				queryFn() as any,
				(snapshot: DocumentSnapshot) => {
					dispatch(asyncActionStart(loadingTag));

					if (!snapshot.exists()) {
						dispatch(
							asyncActionError({
								type: loadingTag,
								error: {
									code: 'not-found',
									message: 'Could not find document',
								},
							}),
						);

						if (isMounted.current) {
							dataFn({});
						}
					} else {
						if (isMounted.current) {
							dataFn(docFn ? docFn(snapshot) : dataFromSnapshot(snapshot, docId));
						}

						dispatch(asyncActionFinish(loadingTag));
					}
				},
				(error: Error) => {
					console.log('error', error);
					if (errorFn && isMounted.current) {
						errorFn();
					}
					dispatch(asyncActionError({ type: loadingTag, error }));
				},
			) as any;

			return () => {
				// Unmounting, stop loading if it still is and unsubscribe from Firestore listener
				unsubscribe();
			};
		}

		console.log("Some of the queryDeps aren't truthful", queryDeps, loadingTag);

		return () => {};
	}, [...deps, queryDepsCompare]); // eslint-disable-line react-hooks/exhaustive-deps

	// Set isMounted ref to true
	useEffect(() => {
		isMounted.current = true;

		return () => {
			isMounted.current = false;
		};
	}, []);
}
