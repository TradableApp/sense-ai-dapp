import { useEffect, useState } from 'react';

import { CloudOff, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppSelector } from '@/store/hooks';

interface StorageUnavailableBannerProps {
	className?: string;
}

/**
 * Shown while the last sync pass left conversation payloads that no storage source could
 * serve (`ui.storageDegraded`). The sync keeps retrying on its own schedule, so the banner
 * is informational: dismissing hides it for the current outage only, and it re-arms once a
 * pass succeeds so a later outage is announced again.
 */
export default function StorageUnavailableBanner({ className }: StorageUnavailableBannerProps) {
	const isDegraded = useAppSelector(state => state.ui.storageDegraded);
	const [isDismissed, setIsDismissed] = useState(false);

	useEffect(() => {
		if (!isDegraded) setIsDismissed(false);
	}, [isDegraded]);

	if (!isDegraded || isDismissed) return null;

	return (
		<Alert
			className={cn(
				'border-amber-500/40 bg-amber-500/10 text-amber-950 [&>svg]:text-amber-600 dark:text-amber-100 dark:[&>svg]:text-amber-400',
				className,
			)}
		>
			<CloudOff className="size-4" />
			<AlertTitle>History temporarily unavailable</AlertTitle>
			<AlertDescription className="pr-8 text-amber-900/80 dark:text-amber-100/80">
				Our storage providers are not responding right now. Retrying automatically — your messages
				will appear as soon as they are reachable.
			</AlertDescription>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Dismiss"
				onClick={() => setIsDismissed(true)}
				className="absolute right-2 top-2 size-7 text-amber-900/70 hover:bg-amber-500/15 hover:text-amber-950 dark:text-amber-100/70 dark:hover:text-amber-50"
			>
				<X className="size-4" />
			</Button>
		</Alert>
	);
}
