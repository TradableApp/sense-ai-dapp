import { ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FEE_TOKEN } from '@/config/feeToken';
import useFeeTokenCheck from '@/hooks/useFeeTokenCheck';
import { feeTokenBlockCopy } from '@/lib/feeTokenCheck';
import { cn } from '@/lib/utils';

interface FeeTokenMismatchBannerProps {
	className?: string;
}

/**
 * Shown while the chain disagrees with the token this build is for (`useFeeTokenCheck`).
 * Sending a prompt and setting a plan are switched off for as long as it shows, so it has
 * no dismiss button: hiding it would leave disabled controls with no explanation. It goes
 * away by itself when a later check passes.
 */
export default function FeeTokenMismatchBanner({ className }: FeeTokenMismatchBannerProps) {
	const { verdict, isBlocked } = useFeeTokenCheck();
	const copy =
		isBlocked && verdict !== 'unknown' ? feeTokenBlockCopy(verdict, FEE_TOKEN.symbol) : null;

	if (!copy) return null;

	return (
		<Alert
			className={cn(
				'border-red-500/40 bg-red-500/10 text-red-950 [&>svg]:text-red-600 dark:text-red-100 dark:[&>svg]:text-red-400',
				className,
			)}
		>
			<ShieldAlert className="size-4" />
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription className="text-red-900/80 dark:text-red-100/80">
				{copy.description}
			</AlertDescription>
		</Alert>
	);
}
