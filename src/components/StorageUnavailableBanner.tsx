import { CloudOff, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { dismissGraphUnavailable, dismissStorageDegraded } from '@/store/uiSlice';

interface StorageUnavailableBannerProps {
	className?: string;
}

/** What the banner says, and which dismissal hides it. */
const NOTICES = {
	graph: {
		title: 'History could not be refreshed',
		description:
			'Your history could not be brought up to date just now. It will be tried again automatically; until then you see what was last saved on this device.',
		dismiss: dismissGraphUnavailable,
	},
	storage: {
		title: 'History temporarily unavailable',
		description:
			'Our storage providers are not responding right now. Retrying automatically — your messages will appear as soon as they are reachable.',
		dismiss: dismissStorageDegraded,
	},
} as const;

/**
 * The history's one banner, with one of two notices. `graph`: the last sync pass could not
 * read The Graph (`ui.graphUnavailable`), so nothing was stored and the history shown is what
 * was saved before. `storage`: it left conversation payloads that no storage source could
 * serve (`ui.storageDegraded`). One pass sets both flags and cannot set both (a pass that
 * cannot read The Graph fetches no payloads); if two passes' flags ever overlap, the Graph
 * notice is shown first. The sync keeps retrying on its own schedule, so the banner is
 * informational. Each notice has its own dismissal, and it lives in the store: the banner is
 * rendered in both Chat and History, and a dismissal must hold across that navigation. It
 * re-arms when a pass succeeds (see `setStorageDegraded`, `setGraphUnavailable`), so a later
 * failure is announced again.
 */
export default function StorageUnavailableBanner({ className }: StorageUnavailableBannerProps) {
	const ui = useAppSelector(state => state.ui);
	const dispatch = useAppDispatch();

	let kind: keyof typeof NOTICES | null = null;
	if (ui.graphUnavailable && !ui.graphUnavailableDismissed) kind = 'graph';
	else if (ui.storageDegraded && !ui.storageDegradedDismissed) kind = 'storage';
	if (kind === null) return null;
	const notice = NOTICES[kind];

	return (
		<Alert
			className={cn(
				'border-amber-500/40 bg-amber-500/10 text-amber-950 [&>svg]:text-amber-600 dark:text-amber-100 dark:[&>svg]:text-amber-400',
				className,
			)}
		>
			<CloudOff className="size-4" />
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription className="pr-8 text-amber-900/80 dark:text-amber-100/80">
				{notice.description}
			</AlertDescription>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Dismiss"
				onClick={() => dispatch(notice.dismiss())}
				className="absolute right-2 top-2 size-7 text-amber-900/70 hover:bg-amber-500/15 hover:text-amber-950 dark:text-amber-100/70 dark:hover:text-amber-50"
			>
				<X className="size-4" />
			</Button>
		</Alert>
	);
}
