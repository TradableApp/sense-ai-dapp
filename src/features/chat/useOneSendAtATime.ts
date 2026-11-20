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

/** `mutation`, whose `mutate` does nothing while `isSendUnderWay` says a send is. */
function startedAlone<TData, TError, TVariables, TContext>(
	mutation: UseMutationResult<TData, TError, TVariables, TContext>,
	isSendUnderWay: () => boolean,
): GuardedSend<TData, TError, TVariables, TContext> {
	const { mutateAsync: _notOffered, ...rest } = mutation;
	return {
		...rest,
		mutate: (variables, options) => {
			if (!isSendUnderWay()) mutation.mutate(variables, options);
		},
	};
}

/**
 * The chat's mutations, with the three that send a paid prompt refusing to start while any
 * of them is being sent, and `isSending` while one is. Both read the query client's mutation
 * cache, so a send outlives the chat being left and opened again, and a mutation is pending
 * there from the moment it starts, so a second press in the same moment is refused too.
 */
export default function useOneSendAtATime(mutations: ChatMutations) {
	const queryClient = useQueryClient();
	const isSending = useIsMutating(PAID_SENDS) > 0;
	const isSendUnderWay = () => queryClient.isMutating(PAID_SENDS) > 0;
	const { initiatePromptMutation, regenerateMutation, branchConversationMutation } = mutations;
	return {
		...mutations,
		initiatePromptMutation: startedAlone(initiatePromptMutation, isSendUnderWay),
		regenerateMutation: startedAlone(regenerateMutation, isSendUnderWay),
		branchConversationMutation: startedAlone(branchConversationMutation, isSendUnderWay),
		isSending,
	};
}
