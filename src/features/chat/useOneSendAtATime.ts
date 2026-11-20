import { useCallback, useRef, useState } from 'react';

import { useIsMutating, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import type useChatMutations from '@/hooks/useChatMutations';

type ChatMutations = ReturnType<typeof useChatMutations>;

/**
 * What the three mutations that send a paid prompt have at the start of their key (a
 * prompt or an edit, regenerate, branch: see `useChatMutations`).
 */
export const PAID_SEND_KEY = ['paid-send'];
const PAID_SENDS = { mutationKey: PAID_SEND_KEY };

/** A sending mutation as the chat gets it: `mutate` refuses, and there is no `mutateAsync`. */
type GuardedSend<TData, TError, TVariables, TContext> = Omit<
	UseMutationResult<TData, TError, TVariables, TContext>,
	'mutateAsync'
>;

/**
 * `mutation`, whose `mutate` does nothing while `isSendUnderWay` says a send is. What the
 * caller's `onSuccess` gives back goes to `untilFinished`, so work the caller does after the
 * send is confirmed still counts as the send.
 */
function startedAlone<TData, TError, TVariables, TContext>(
	mutation: UseMutationResult<TData, TError, TVariables, TContext>,
	isSendUnderWay: () => boolean,
	untilFinished: (_work: unknown) => void,
): GuardedSend<TData, TError, TVariables, TContext> {
	const { mutateAsync: _notOffered, ...rest } = mutation;
	return {
		...rest,
		mutate: (variables, options) => {
			if (isSendUnderWay()) return;
			const onSuccess = options?.onSuccess;
			mutation.mutate(
				variables,
				onSuccess
					? { ...options, onSuccess: (...result) => untilFinished(onSuccess(...result)) }
					: options,
			);
		},
	};
}

/**
 * The chat's mutations, with the three that send a paid prompt refusing to start while any
 * of them is being sent, and `isSending` while one is.
 *
 * A send is under way from the moment it starts until two things have ended. The first is the
 * mutation, read from the query client's mutation cache: it is pending there as soon as it
 * starts, so a second press in the same moment is refused, and it is still there when the
 * chat is left and opened again. The second is what the chat does once the send is confirmed
 * (the `onSuccess` it passes to `mutate`): it writes the prompt to the local store and only
 * then clears the composer and shows the answer as awaited, and until it has, a press would
 * send the same prompt again. That work is counted here, in this mounted chat only: the
 * library does not run it for a chat that has been left.
 */
export default function useOneSendAtATime(mutations: ChatMutations) {
	const queryClient = useQueryClient();
	const isMutating = useIsMutating(PAID_SENDS) > 0;
	// The ref answers a press at once; the state redraws the controls.
	const finishing = useRef(0);
	const [isFinishing, setIsFinishing] = useState(false);
	const untilFinished = useCallback((work: unknown) => {
		if (!(work instanceof Promise)) return;
		const count = (change: 1 | -1) => {
			finishing.current += change;
			setIsFinishing(finishing.current > 0);
		};
		count(1);
		work.then(
			() => count(-1),
			(error: unknown) => {
				count(-1);
				console.error('A prompt was sent, but saving it on this device failed:', error);
			},
		);
	}, []);
	const isSendUnderWay = () => queryClient.isMutating(PAID_SENDS) > 0 || finishing.current > 0;
	const { initiatePromptMutation, regenerateMutation, branchConversationMutation } = mutations;
	return {
		...mutations,
		initiatePromptMutation: startedAlone(initiatePromptMutation, isSendUnderWay, untilFinished),
		regenerateMutation: startedAlone(regenerateMutation, isSendUnderWay, untilFinished),
		branchConversationMutation: startedAlone(
			branchConversationMutation,
			isSendUnderWay,
			untilFinished,
		),
		isSending: isMutating || isFinishing,
	};
}
