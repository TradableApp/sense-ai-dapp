import { useCallback, useRef, useSyncExternalStore } from 'react';

import * as Sentry from '@sentry/react';
import {
	type MutateOptions,
	type QueryClient,
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

/**
 * Called as a send starts, with which send it is and what clears the caller's input; gives
 * back what counts the caller's work once the send is confirmed. Called at the start so the
 * session the send was made in is the one a failed save asks to sync.
 */
type UntilFinished = (_kind: SendKind, _onSaveFailed?: () => void) => (_work: unknown) => void;

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
			const finished = untilFinished(kind, onSaveFailed);
			mutation.mutate(
				variables,
				onSuccess
					? { ...callbacks, onSuccess: (...result) => finished(onSuccess(...result)) }
					: callbacks,
			);
		},
	};
}

/**
 * How many confirmed sends are still being saved, kept per query client rather than per
 * mounted chat: a chat left and opened again while a save is running must still refuse.
 */
interface FinishingStore {
	count: number;
	listeners: Set<() => void>;
}

const finishingByClient = new WeakMap<QueryClient, FinishingStore>();

function finishingFor(queryClient: QueryClient): FinishingStore {
	const known = finishingByClient.get(queryClient);
	if (known) return known;
	const store: FinishingStore = { count: 0, listeners: new Set() };
	finishingByClient.set(queryClient, store);
	return store;
}

function changeFinishing(store: FinishingStore, change: 1 | -1): void {
	// An external store, changed in place and announced, as useSyncExternalStore expects.
	// eslint-disable-next-line no-param-reassign
	store.count += change;
	store.listeners.forEach(listener => listener());
}

/** What the console and the report may say of an error: its name, never its message. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** Runs one step of the failure handling; a step that throws is logged and the rest go on. */
function attempt(step: string, run: () => unknown): void {
	try {
		run();
	} catch (error) {
		console.error(`After a failed save, ${step} failed:`, errorName(error));
	}
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

/** One id, so a second failure replaces the warning instead of stacking another. */
export const SAVE_FAILED_TOAST_ID = 'paid-send-not-saved';

/**
 * What the user is told: it was sent and paid for, it will appear, and not to send it again.
 * It stays until closed: on regenerate and branch there is nothing to clear, so it is all
 * that stands between the user and a second press.
 */
function announceSaveFailure(kind: SendKind): void {
	toast.warning('Sent, Not Yet Shown', {
		id: SAVE_FAILED_TOAST_ID,
		duration: Infinity,
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
 * send the same prompt again. That work is counted per query client, so a chat opened again
 * still sees it. The library runs that `onSuccess` only for the chat that started the send: if
 * the chat is left before the transaction is confirmed, its save and the warning below do not
 * run, and the prompt comes back through the sync.
 *
 * When that work fails after the send was confirmed, the user is warned, the caller's
 * `onSaveFailed` clears its input, it is reported once per page load and a sync is asked for.
 * Each step runs even if another throws, and the lock is released whatever happens.
 */
export default function useOneSendAtATime(mutations: ChatMutations) {
	const queryClient = useQueryClient();
	const { sessionKey, ownerAddress } = useSession();
	const isMutating = useIsMutating(PAID_SENDS) > 0;
	const store = finishingFor(queryClient);
	const subscribe = useCallback(
		(listener: () => void) => {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		},
		[store],
	);
	const isFinishing = useSyncExternalStore(subscribe, () => store.count > 0);
	// Read as a send starts, which can be after a later render.
	const session = useRef({ sessionKey, ownerAddress });
	session.current = { sessionKey, ownerAddress };
	const untilFinished = useCallback<UntilFinished>(
		(kind, onSaveFailed) => {
			const { sessionKey: key, ownerAddress: owner } = session.current;
			return work => {
				if (!(work instanceof Promise)) return;
				changeFinishing(store, 1);
				work.then(
					() => changeFinishing(store, -1),
					(error: unknown) => {
						// The send was confirmed and paid for: what is left is to show it. The sync
						// brings it from the chain; until then the chat must not offer the same text
						// for a second payment.
						try {
							console.error(
								'A prompt was sent, but saving it on this device failed:',
								errorName(error),
							);
							attempt('the warning', () => announceSaveFailure(kind));
							attempt('clearing the input', () => onSaveFailed?.());
							attempt('the report', () => reportSaveFailure(kind, error));
							attempt('asking for a sync', () =>
								queryClient.invalidateQueries({ queryKey: ['conversations', key, owner] }),
							);
						} finally {
							changeFinishing(store, -1);
						}
					},
				);
			};
		},
		[queryClient, store],
	);
	const isSendUnderWay = () => queryClient.isMutating(PAID_SENDS) > 0 || store.count > 0;
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
