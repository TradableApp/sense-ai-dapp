import { useCallback, useRef, useState } from 'react';

import * as Sentry from '@sentry/react';
import {
	type MutateOptions,
	useIsMutating,
	type UseMutationResult,
	useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { useSession } from '@/features/auth/SessionProvider';
import type useChatMutations from '@/hooks/useChatMutations';

type ChatMutations = ReturnType<typeof useChatMutations>;

/**
 * What the three mutations that send a paid prompt have at the start of their key (a
 * prompt or an edit, regenerate, branch: see `useChatMutations`).
 */
export const PAID_SEND_KEY = ['paid-send'];
const PAID_SENDS = { mutationKey: PAID_SEND_KEY };

/** Which paid send it was, for the words the user is shown and the report's tag. */
type SendKind = 'prompt' | 'regenerate' | 'branch';

const SENT_WHAT: Record<SendKind, string> = {
	prompt: 'Your prompt',
	regenerate: 'Your request for a new answer',
	branch: 'Your new branch',
};

/**
 * What the chat passes to `mutate` besides the variables. `onSaveFailed` is called when the
 * send was confirmed but `onSuccess`'s work then failed: the chat clears what it shows (the
 * composer, the edit box), since the text has been paid for and a press would pay again.
 */
type SendOptions<TData, TError, TVariables, TContext> = MutateOptions<
	TData,
	TError,
	TVariables,
	TContext
> & { onSaveFailed?: () => void };

/** A sending mutation as the chat gets it: `mutate` refuses, and there is no `mutateAsync`. */
type GuardedSend<TData, TError, TVariables, TContext> = Omit<
	UseMutationResult<TData, TError, TVariables, TContext>,
	'mutateAsync' | 'mutate'
> & {
	mutate: (
		_variables: TVariables,
		_options?: SendOptions<TData, TError, TVariables, TContext>,
	) => void;
};

/** Counts the caller's work after a confirmed send, and is told when that work failed. */
type UntilFinished = (_work: unknown, _kind: SendKind, _onSaveFailed?: () => void) => void;

/**
 * `mutation`, whose `mutate` does nothing while `isSendUnderWay` says a send is. What the
 * caller's `onSuccess` gives back goes to `untilFinished`, so work the caller does after the
 * send is confirmed still counts as the send.
 */
function startedAlone<TData, TError, TVariables, TContext>(
	mutation: UseMutationResult<TData, TError, TVariables, TContext>,
	isSendUnderWay: () => boolean,
	untilFinished: UntilFinished,
	kind: SendKind,
): GuardedSend<TData, TError, TVariables, TContext> {
	const { mutateAsync: _notOffered, ...rest } = mutation;
	return {
		...rest,
		mutate: (variables, options) => {
			if (isSendUnderWay()) return;
			const { onSaveFailed, ...callbacks } = options ?? {};
			const { onSuccess } = callbacks;
			mutation.mutate(
				variables,
				onSuccess
					? {
							...callbacks,
							onSuccess: (...result) => untilFinished(onSuccess(...result), kind, onSaveFailed),
					  }
					: callbacks,
			);
		},
	};
}

// Reported once per page load: a device whose store refuses every write would otherwise send
// one report per prompt.
let hasReportedSaveFailure = false;

/** Starts reporting afresh, as a page load does. For tests, which share this module. */
export function forgetSaveFailureReports(): void {
	hasReportedSaveFailure = false;
}

/**
 * Reports a confirmed send whose local save failed. Never the error itself: what a storage or
 * crypto library puts in its message is not ours to vouch for, and the prompt's text must not
 * reach the tracker. Its name says which kind of failure it was.
 */
function reportSaveFailure(kind: SendKind, error: unknown): void {
	if (hasReportedSaveFailure) return;
	hasReportedSaveFailure = true;
	Sentry.captureException(
		new Error('A paid send was confirmed, but saving it on this device failed.'),
		{
			tags: { check: 'paid-send-save', send: kind },
			extra: { errorName: error instanceof Error ? error.name : typeof error },
			fingerprint: ['paid-send-save-failed'],
		},
	);
}

/** What the user is told: it was sent and paid for, it will appear, and not to send it again. */
function announceSaveFailure(kind: SendKind): void {
	toast.warning('Sent, Not Yet Shown', {
		description: `${SENT_WHAT[kind]} was sent and paid for, but saving it on this device failed. It will appear once your history syncs, so there is no need to send it again.`,
	});
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
	const { sessionKey, ownerAddress } = useSession();
	const isMutating = useIsMutating(PAID_SENDS) > 0;
	// The ref answers a press at once; the state redraws the controls.
	const finishing = useRef(0);
	const [isFinishing, setIsFinishing] = useState(false);
	// Read when the work fails, which can be after a later render.
	const session = useRef({ sessionKey, ownerAddress });
	session.current = { sessionKey, ownerAddress };
	const untilFinished = useCallback<UntilFinished>(
		(work, kind, onSaveFailed) => {
			if (!(work instanceof Promise)) return;
			const count = (change: 1 | -1) => {
				finishing.current += change;
				setIsFinishing(finishing.current > 0);
			};
			count(1);
			work.then(
				() => count(-1),
				(error: unknown) => {
					// The send was confirmed and paid for: what is left is to show it. The sync
					// brings it from the chain; until then the chat must not offer the same text
					// for a second payment.
					console.error('A prompt was sent, but saving it on this device failed:', error);
					onSaveFailed?.();
					announceSaveFailure(kind);
					reportSaveFailure(kind, error);
					const { sessionKey: key, ownerAddress: owner } = session.current;
					queryClient.invalidateQueries({ queryKey: ['conversations', key, owner] });
					count(-1);
				},
			);
		},
		[queryClient],
	);
	const isSendUnderWay = () => queryClient.isMutating(PAID_SENDS) > 0 || finishing.current > 0;
	const { initiatePromptMutation, regenerateMutation, branchConversationMutation } = mutations;
	return {
		...mutations,
		initiatePromptMutation: startedAlone(
			initiatePromptMutation,
			isSendUnderWay,
			untilFinished,
			'prompt',
		),
		regenerateMutation: startedAlone(
			regenerateMutation,
			isSendUnderWay,
			untilFinished,
			'regenerate',
		),
		branchConversationMutation: startedAlone(
			branchConversationMutation,
			isSendUnderWay,
			untilFinished,
			'branch',
		),
		isSending: isMutating || isFinishing,
	};
}
