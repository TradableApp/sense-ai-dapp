import { useCallback, useMemo } from 'react';

import { useQueries, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/SessionProvider';
import {
	type AnswerRating,
	ratingDeployment,
	ratingDocId,
	readAnswerRating,
} from '@/lib/answerRating';
import createLimiter from '@/lib/limitConcurrency';

/** At most this many rating reads are in flight at once, across every conversation. */
export const RATING_READ_CONCURRENCY = 4;

const limitRead = createLimiter(RATING_READ_CONCURRENCY);

/** A rating changes only when the user rates; another device's change shows after a reload. */
const RATING_STALE_MS = Infinity;

/** The key holds no session key and no rating id: only what is already in the messages key. */
const ratingKey = (ownerAddress: string, conversationId: string, messageId: string) =>
	['answerRating', ownerAddress, conversationId, messageId] as const;

/**
 * The ratings of the answers shown in one conversation, read one document at a time by the id
 * only the session key holder can compute. Each answer is read once and kept in the query cache,
 * so a new answer costs one read, and every read waits for one of a few slots, so a long
 * conversation never sends a burst. A failed read shows no rating.
 *
 * `remember` puts a rating the user has just saved (or removed, with null) into the cache,
 * after ending any read of that answer still under way.
 */
export default function useAnswerRatings(conversationId: string | null, answerIds: string[]) {
	const { sessionKey, ownerAddress } = useSession();
	const queryClient = useQueryClient();
	const deployment = ratingDeployment();
	const enabled = Boolean(sessionKey && ownerAddress && conversationId && deployment);

	const results = useQueries({
		queries: answerIds.map(messageId => ({
			queryKey: ratingKey(ownerAddress ?? '', conversationId ?? '', messageId),
			enabled,
			staleTime: RATING_STALE_MS,
			// Kept for the page load: leaving a conversation and coming back reads nothing again.
			gcTime: Infinity,
			retry: 1,
			refetchOnWindowFocus: false,
			queryFn: () =>
				limitRead(async () => {
					try {
						const docId = await ratingDocId(sessionKey as CryptoKey, {
							chainId: deployment!.chainId,
							agentAddress: deployment!.agentAddress,
							conversationId: conversationId as string,
							messageId,
						});
						return await readAnswerRating(docId);
					} catch (error) {
						console.warn(
							'[useAnswerRatings] A rating could not be read:',
							error instanceof Error ? error.name : typeof error,
						);
						throw error;
					}
				}),
		})),
	});

	const ratings = useMemo(() => {
		const map: Record<string, AnswerRating> = {};
		answerIds.forEach((messageId, i) => {
			const value = results[i]?.data;
			if (value) map[messageId] = value;
		});
		return map;
	}, [answerIds, results]);

	const remember = useCallback(
		(messageId: string, value: AnswerRating | null) => {
			if (!ownerAddress || !conversationId) return;
			const key = ratingKey(ownerAddress, conversationId, messageId);
			// A read of this answer that is still queued or under way started before the save. It is
			// ended first, and the saved value is written once it has ended, so its older answer
			// cannot replace the newer one.
			queryClient
				.cancelQueries({ queryKey: key })
				.catch(() => {})
				.then(() => queryClient.setQueryData(key, value));
		},
		[queryClient, ownerAddress, conversationId],
	);

	return { ratings, remember };
}
