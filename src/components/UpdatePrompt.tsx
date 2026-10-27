import { useEffect, useRef } from 'react';

import * as Sentry from '@sentry/react';
import { useIsMutating } from '@tanstack/react-query';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { toast } from '@/components/ui/sonner';
import { useSession } from '@/features/auth/SessionProvider';
import { decideUpdatePrompt } from '@/lib/updatePrompt';

/** Fixed toast id: re-issuing with the same id updates in place instead of stacking. */
export const UPDATE_TOAST_ID = 'app-update';

const breadcrumb = (message: string, data?: Record<string, unknown>) =>
	Sentry.addBreadcrumb({ category: 'app.update', level: 'info', message, data });

/**
 * Offers the reload for a waiting service worker (sense-ai-dapp#81).
 *
 * Renders nothing itself; it drives one sonner toast. The worker is registered in `prompt`
 * mode (see vite.config.ts and the `pwa-prompt-mode` guard), so nothing reloads until the
 * user clicks Reload — and the offer is withheld, or withdrawn, while a wallet flow is in
 * flight, because a reload then aborts the signature and strands the user on /auth.
 *
 * Mount inside QueryClientProvider (pending mutations) and SessionProvider (key derivation).
 */
export default function UpdatePrompt() {
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		onRegisterError: error =>
			breadcrumb('service worker registration failed', { error: String(error) }),
	});
	const pendingMutations = useIsMutating();
	const { status } = useSession();
	const isBusy = pendingMutations > 0 || status === 'deriving';
	const decision = decideUpdatePrompt({ needRefresh, isBusy });

	// Whether our toast is currently on screen, and whether a dismissal in progress is ours
	// (a withdrawal) rather than the user's. sonner may route a programmatic dismiss through
	// onDismiss as well; a withdrawal must keep needRefresh so the prompt can come back.
	const showingRef = useRef(false);
	const withdrawingRef = useRef(false);

	useEffect(() => {
		if (decision === 'show') {
			toast('A new version of SenseAI is ready.', {
				id: UPDATE_TOAST_ID,
				duration: Infinity,
				description: 'Reload to use it. Nothing is lost if you wait.',
				action: {
					label: 'Reload',
					onClick: () => {
						breadcrumb('update accepted, reloading through the waiting worker');
						updateServiceWorker(true).catch((error: unknown) =>
							breadcrumb('update failed to activate', { error: String(error) }),
						);
					},
				},
				onDismiss: () => {
					if (withdrawingRef.current) return;
					breadcrumb('update dismissed by the user');
					setNeedRefresh(false);
				},
			});
			if (!showingRef.current) breadcrumb('update available, prompt shown');
			showingRef.current = true;
			return;
		}

		if (decision === 'defer') {
			if (showingRef.current) {
				withdrawingRef.current = true;
				toast.dismiss(UPDATE_TOAST_ID);
				withdrawingRef.current = false;
				showingRef.current = false;
				breadcrumb('update prompt withdrawn: wallet flow in flight');
			} else {
				breadcrumb('update available, deferred: wallet flow in flight');
			}
			return;
		}

		showingRef.current = false;
	}, [decision, setNeedRefresh, updateServiceWorker]);

	return null;
}
