import { useEffect, useRef } from 'react';

import { onSnapshot } from 'firebase/firestore';
import { useDispatch } from 'react-redux';

import { dataFromSnapshot } from '@/lib/firestoreService';
import { asyncActionError, asyncActionFinish, asyncActionStart } from '@/store/asyncSlice';

import useCompare from './useCompare';

export default function useFirestoreCollectionListener({
	queryFn,
	queryDeps,
	continueOnQueryChange,
	docFn,
	docId,
	dataFn,
	errorFn,
	loadingTag = 'useFirestoreCollectionListener',
	deps,
}) {
	const dispatch = useDispatch();

	// Previous state/ prop values for comparison
	const queryDepsCompare = useCompare(queryDeps);

	// Set isMounted ref
	const isMounted = useRef(false);

	useEffect(() => {
		if (queryDepsCompare && !continueOnQueryChange && isMounted.current) {
			console.log('None loadingTag', loadingTag);

			dataFn([]);
		}

		if (!queryDeps || queryDeps.length === 0 || queryDeps.every(dep => !!dep)) {
			dispatch(asyncActionStart(loadingTag));

			const unsubscribe = onSnapshot(
				queryFn(),
				snapshot => {
					dispatch(asyncActionStart(loadingTag));

					if (snapshot.empty) {
						dispatch(
							asyncActionError(loadingTag, {
								code: 'not-found',
								message: 'Could not find any documents',
							}),
						);

						if (isMounted.current) {
							console.log('None loadingTag', loadingTag);

							dataFn([]);
						}
					} else {
						const docs = snapshot.docs.map(doc =>
							docFn ? docFn(doc) : dataFromSnapshot(doc, docId),
						);
						// console.log('docs', docs);

						if (isMounted.current) {
							dataFn(docs);
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
		console.log('None loadingTag', loadingTag);
		dataFn([]);

		return () => {};
	}, deps); // eslint-disable-line react-hooks/exhaustive-deps

	// Set isMounted ref to true
	useEffect(() => {
		isMounted.current = true;

		return () => {
			isMounted.current = false;
		};
	}, []);
}
