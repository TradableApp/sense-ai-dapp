import { useRef } from 'react';

import type { UseMutationResult } from '@tanstack/react-query';

import type useChatMutations from '@/hooks/useChatMutations';

type ChatMutations = ReturnType<typeof useChatMutations>;

/** Says whether a send is under way, and starts and ends one. */
interface SendLock {
	tryStart: () => boolean;
	end: () => void;
}

/** `mutation`, whose `mutate` does nothing while another send holds `lock`. */
function startedAlone<TData, TError, TVariables, TContext>(
	mutation: UseMutationResult<TData, TError, TVariables, TContext>,
	lock: SendLock,
): UseMutationResult<TData, TError, TVariables, TContext> {
	return {
		...mutation,
		mutate: (variables, options) => {
			if (!lock.tryStart()) return;
			mutation.mutate(variables, {
				...options,
				onSettled: (...settled) => {
					lock.end();
					options?.onSettled?.(...settled);
				},
			});
		},
	};
}

/**
 * The chat's mutations, with the three that send a paid prompt (a prompt or an edit,
 * regenerate, branch) refusing to start while any of them is being sent, and `isSending`
 * while one is. The controls are disabled from `isSending`; the refusal is for a second
 * press that comes before they are, since `isPending` reaches the screen a render later
 * than the press. Only `mutate` is guarded: the chat calls nothing else.
 */
export default function useOneSendAtATime(mutations: ChatMutations) {
	const isStarted = useRef(false);
	const lock: SendLock = {
		tryStart: () => {
			if (isStarted.current) return false;
			isStarted.current = true;
			return true;
		},
		end: () => {
			isStarted.current = false;
		},
	};
	const { initiatePromptMutation, regenerateMutation, branchConversationMutation } = mutations;
	return {
		...mutations,
		initiatePromptMutation: startedAlone(initiatePromptMutation, lock),
		regenerateMutation: startedAlone(regenerateMutation, lock),
		branchConversationMutation: startedAlone(branchConversationMutation, lock),
		isSending:
			initiatePromptMutation.isPending ||
			regenerateMutation.isPending ||
			branchConversationMutation.isPending,
	};
}
