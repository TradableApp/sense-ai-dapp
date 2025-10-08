import { useEffect, useRef } from 'react';

import { onSnapshot } from 'firebase/firestore';
import { useDispatch } from 'react-redux';

import { dataFromSnapshot } from '@/lib/firestoreService';
import { asyncActionError, asyncActionFinish, asyncActionStart } from '@/store/asyncSlice';

import useCompare from './useCompare';

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
}) {
	// Redux Dispatch
	const dispatch = useDispatch();

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
				queryFn(),
				snapshot => {
					dispatch(asyncActionStart(loadingTag));

					if (!snapshot.exists()) {
						dispatch(
							asyncActionError(loadingTag, {
								code: 'not-found',
								message: 'Could not find document',
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
				error => {
					console.log('error', error);
					if (errorFn && isMounted.current) {
						errorFn();
					}
					dispatch(asyncActionError(loadingTag, error));
				},
			);

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
