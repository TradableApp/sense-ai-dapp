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

	// Whether our toast is on screen, which showing it is (a generation per toast() call), and
	// which generation we withdrew. sonner reports a programmatic dismiss through onDismiss
	// too, but only after React re-renders the toast with its delete flag — asynchronously —
	// so the callback checks its own generation against the withdrawn one instead of a flag
	// that would have been reset by then. A withdrawal must keep needRefresh so the prompt
	// can come back once the wallet flow settles.
	const showingRef = useRef(false);
	const generationRef = useRef(0);
	const withdrawnGenerationRef = useRef<number | null>(null);

	useEffect(() => {
		if (decision === 'show') {
			generationRef.current += 1;
			const generation = generationRef.current;
			toast('A new version of SenseAI is ready.', {
				id: UPDATE_TOAST_ID,
				duration: Infinity,
				description: 'Reload to use it. Nothing is lost if you wait.',
				action: {
					label: 'Reload',
					onClick: () => {
						breadcrumb('update accepted, reloading through the waiting worker');
						updateServiceWorker(true).catch((error: unknown) => {
							// The action click already closed the prompt; without this the user has
							// no way back to the new build until the next navigation.
							breadcrumb('update failed to activate', { error: String(error) });
							showingRef.current = false;
							toast.error('The update could not be applied.', {
								description: 'Reload the page to get the new version.',
								action: { label: 'Reload', onClick: () => window.location.reload() },
							});
						});
					},
				},
				onDismiss: () => {
					if (withdrawnGenerationRef.current === generation) return;
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
				withdrawnGenerationRef.current = generationRef.current;
				toast.dismiss(UPDATE_TOAST_ID);
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
