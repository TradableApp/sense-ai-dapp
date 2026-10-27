/**
 * When to offer a service-worker update (sense-ai-dapp#81).
 *
 * The worker runs in `prompt` mode, so a new build only ever waits; the user chooses when
 * to reload. This decides whether to put that choice in front of them right now:
 *
 * - `none`  — no new worker is waiting.
 * - `show`  — a worker is waiting and nothing is in flight: offer the reload.
 * - `defer` — a worker is waiting but a wallet flow is in flight (a transaction mutation or
 *             the session-key signature). A reload now would abort it, so hold the prompt
 *             (and withdraw it if it is already showing) until the flow settles.
 *
 * Pure: the component derives `isBusy` from live state and re-evaluates on every change, so
 * a deferred prompt surfaces on its own the moment the flow finishes.
 */

export type UpdatePromptDecision = 'none' | 'show' | 'defer';

export interface UpdatePromptInputs {
	/** A new service worker is installed and waiting (vite-plugin-pwa `needRefresh`). */
	readonly needRefresh: boolean;
	/** A wallet flow is in flight: any pending mutation, or the session key being derived. */
	readonly isBusy: boolean;
}

export function decideUpdatePrompt({
	needRefresh,
	isBusy,
}: UpdatePromptInputs): UpdatePromptDecision {
	if (!needRefresh) return 'none';
	return isBusy ? 'defer' : 'show';
}
