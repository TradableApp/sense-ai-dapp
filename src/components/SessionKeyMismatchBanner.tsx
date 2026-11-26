import { useState } from 'react';

import { KeyRound, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import useSessionKeyCheck from '@/hooks/useSessionKeyCheck';
import { cn } from '@/lib/utils';

interface SessionKeyMismatchBannerProps {
	className?: string;
}

/**
 * Shown when the key check (`src/lib/sessionKeyCheck.ts`) finds that the history on this
 * device was written under another key than this session's: the wallet's signature is not the
 * one it gave before. Nothing is deleted and nothing is held; new use works as usual. The
 * dismissal lasts for the page load.
 */
export default function SessionKeyMismatchBanner({ className }: SessionKeyMismatchBannerProps) {
	const check = useSessionKeyCheck();
	const [isDismissed, setIsDismissed] = useState(false);
	if (check !== 'mismatch' || isDismissed) return null;

	return (
		<Alert
			className={cn(
				'border-amber-500/40 bg-amber-500/10 text-amber-950 [&>svg]:text-amber-600 dark:text-amber-100 dark:[&>svg]:text-amber-400',
				className,
			)}
		>
			<KeyRound className="size-4" />
			<AlertTitle>Some history on this device cannot be opened</AlertTitle>
			<AlertDescription className="pr-8 text-amber-900/80 dark:text-amber-100/80">
				History on this device was saved with a key from a different signature by this wallet, so it
				cannot be opened here with the signature just given. Nothing has been deleted, and you can
				keep using SenseAI as usual.
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
