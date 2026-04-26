import { useEffect, useRef } from 'react';

import type { DocumentSnapshot, Query } from 'firebase/firestore';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { dataFromSnapshot } from '@/lib/firestoreService';
import { asyncActionError, asyncActionFinish, asyncActionStart } from '@/store/asyncSlice';
import { useAppDispatch } from '@/store/hooks';

import useCompare from './useCompare';
import usePrevious from './usePrevious';

interface Metric {
	key: string;
	metric: string;
	value: any;
}

interface FirestoreMultiDocumentListenerProps {
	queryFn: () => any;
	queryDeps: (string | number | null | undefined)[] | null;
	queryCollection?: string;
	docIds?: string[];
	metrics?: Metric[];
	queryKey?: string;
	queryMetric?: string;
	queryValues?: string[];
	docFn?: (doc: any) => any;
	docId?: string;
	dataFn: (id: string, data: any) => void;
	errorFn?: () => void;
	deps: unknown[];
	shouldExecute?: boolean;
	loadingTag?: string;
}

export default function useFirestoreMultiDocumentListener({
	queryFn,
	queryDeps,
	queryCollection,
	docIds,
	metrics,
	queryKey,
	queryMetric,
	queryValues,
	docFn,
	docId,
	dataFn,
	errorFn,
	deps,
	shouldExecute = true,
	loadingTag = 'useFirestoreMultiDocumentListener',
}: FirestoreMultiDocumentListenerProps) {
	// Redux Dispatch
	const dispatch = useAppDispatch();

	// Previous state/ prop values for comparison
	const queryDepsCompare = useCompare(queryDeps);
	const docIdsCompare = useCompare(docIds);
	const previousDocIds = usePrevious(docIds);
	const queryValuesCompare = useCompare(queryValues);
	const previousQueryValues = usePrevious(queryValues);

	// Set isMounted ref
	const isMounted = useRef(false);
	const docsRef = useRef<Record<string, any>>({});
	const loadingRef = useRef<Record<string, boolean>>({});

	useEffect(() => {
		if (!shouldExecute) return null;

		if (queryDepsCompare && isMounted.current) {
			const currentDocIds = Object.keys(docsRef.current);

			currentDocIds.forEach((currentDocId: string) => {
				dataFn(currentDocId, {});
			});
		} else if (docIdsCompare) {
			// Check if any docIds have been removed, if so unsubscribe and clear data
			((previousDocIds as string[]) || []).forEach((previousDocId: string) => {
				if (!docIds?.includes(previousDocId)) {
					// console.log('Document removed', previousDocId);

					docsRef.current[previousDocId]();
					dataFn(previousDocId, {});
				}
			});
		} else if (queryValuesCompare) {
			// Check if any queryValues have been removed, if so unsubscribe and clear data
			((previousQueryValues as string[]) || []).forEach((previousQueryValue: string) => {
				if (!queryValues?.includes(previousQueryValue)) {
					// console.log('Document removed', previousQueryValue);

					docsRef.current[previousQueryValue]();
					dataFn(previousQueryValue, {});
				}
			});
		}

		if (!queryDeps || queryDeps.length === 0 || queryDeps.every(dep => !!dep)) {
			dispatch(asyncActionStart(loadingTag));

			if (docIds) {
				docIds.forEach((currentDocId: string) => {
					if (!loadingRef.current[currentDocId]) {
						loadingRef.current[currentDocId] = true;
					}

					// Store unsubscribe for each docId in docsRef if it's not already stored
					if (!docsRef.current[currentDocId]) {
						docsRef.current[currentDocId] = onSnapshot(
							doc(queryFn() as any, queryCollection, currentDocId),
							(snapshot: DocumentSnapshot) => {
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
										dataFn(currentDocId, {});
									}
								} else {
									if (isMounted.current) {
										dataFn(
											currentDocId,
											docFn ? docFn(snapshot) : dataFromSnapshot(snapshot, docId),
										);
									}

									loadingRef.current[currentDocId] = false;
									if (docIds.every((id: string) => !loadingRef.current[id])) {
										dispatch(asyncActionFinish(loadingTag));
									}
								}
							},
							(error: Error) => {
								console.log('error', error);
								if (errorFn && isMounted.current) {
									errorFn();
								}

								loadingRef.current[currentDocId] = false;
								if (docIds.every((id: string) => !loadingRef.current[id])) {
									dispatch(asyncActionFinish(loadingTag));
								}
							},
						) as any;
					} else {
						loadingRef.current[currentDocId] = false;
						if (docIds.every((id: string) => !loadingRef.current[id])) {
							dispatch(asyncActionFinish(loadingTag));
						}
					}
				});

				if (docIds.every((id: string) => !loadingRef.current[id])) {
					dispatch(asyncActionFinish(loadingTag));
				}
			} else if (queryKey && queryMetric && queryValues) {
				queryValues.forEach((currentQueryValue: string) => {
					if (!loadingRef.current[currentQueryValue]) {
						loadingRef.current[currentQueryValue] = true;
					}

					// Store unsubscribe for each docId in docsRef if it's not already stored
					if (!docsRef.current[currentQueryValue]) {
						console.log(
							'queryKey',
							queryKey,
							'queryMetric',
							queryMetric,
							'currentQueryValue',
							currentQueryValue,
						);

						docsRef.current[currentQueryValue] = collection(queryFn() as any, queryCollection);

						if (metrics && metrics.length > 0) {
							metrics.forEach((metric: Metric) => {
								docsRef.current[currentQueryValue] = query(
									docsRef.current[currentQueryValue] as any,
									where(metric.key, metric.metric as any, metric.value),
								);
							});
						}

						docsRef.current[currentQueryValue] = onSnapshot(
							query(
								docsRef.current[currentQueryValue] as any,
								where(queryKey, queryMetric as any, currentQueryValue),
							),
							(snapshot: any) => {
								console.log('snapshot', snapshot);
								if (snapshot.empty) {
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
										dataFn(currentQueryValue, {});
									}
								} else {
									if (isMounted.current) {
										const requiredDoc = snapshot.docs[0];

										dataFn(
											currentQueryValue,
											docFn ? docFn(requiredDoc) : dataFromSnapshot(requiredDoc, docId),
										);
									}

									loadingRef.current[currentQueryValue] = false;
									if (queryValues.every((queryValue: string) => !loadingRef.current[queryValue])) {
										dispatch(asyncActionFinish(loadingTag));
									}
								}
							},
							(error: Error) => {
								console.log('error', error);
								if (errorFn && isMounted.current) {
									errorFn();
								}

								loadingRef.current[currentQueryValue] = false;
								if (queryValues.every((queryValue: string) => !loadingRef.current[queryValue])) {
									dispatch(asyncActionFinish(loadingTag));
								}
							},
						) as any;
					} else {
						loadingRef.current[currentQueryValue] = false;
						if (queryValues.every((queryValue: string) => !loadingRef.current[queryValue])) {
							dispatch(asyncActionFinish(loadingTag));
						}
					}
				});

				if (queryValues.every((queryValue: string) => !loadingRef.current[queryValue])) {
					dispatch(asyncActionFinish(loadingTag));
				}
			}

			return () => {
				// Unmounting, stop loading if it still is and unsubscribe from Firestore listeners if queryDepsCompare
				if (queryDepsCompare) {
					const currentDocIds = Object.keys(docsRef.current);

					currentDocIds.forEach((currentDocId: string) => {
						docsRef.current[currentDocId]();
						delete docsRef.current[currentDocId];
					});
				}
			};
		}

		console.log("Some of the queryDeps aren't truthful", queryDeps, loadingTag);

		return () => {};
	}, [...deps, queryDepsCompare, docIdsCompare]); // eslint-disable-line react-hooks/exhaustive-deps

	// Set isMounted ref to true
	useEffect(() => {
		isMounted.current = true;

		return () => {
			isMounted.current = false;

			const currentDocIds = Object.keys(docsRef.current);

			currentDocIds.forEach((currentDocId: string) => {
				docsRef.current[currentDocId]();
			});

			docsRef.current = {};
		};
	}, []);
}
