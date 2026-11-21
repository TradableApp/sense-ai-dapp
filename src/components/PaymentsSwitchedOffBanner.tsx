import { CirclePause, ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FEE_TOKEN } from '@/config/feeToken';
import usePaymentGate from '@/hooks/usePaymentGate';
import { gateCopy } from '@/lib/paymentGate';
import { cn } from '@/lib/utils';

interface PaymentsSwitchedOffBannerProps {
	className?: string;
}

// The switch is a closure someone chose; a fee token notice is something wrong. They look
// different so the second is not read as more of the first.
const TONE = {
	switch: {
		alert:
			'border-amber-500/40 bg-amber-500/10 text-amber-950 [&>svg]:text-amber-600 dark:text-amber-100 dark:[&>svg]:text-amber-400',
		description: 'text-amber-900/80 dark:text-amber-100/80',
		Icon: CirclePause,
	},
	feeToken: {
		alert:
			'border-red-500/40 bg-red-500/10 text-red-950 [&>svg]:text-red-600 dark:text-red-100 dark:[&>svg]:text-red-400',
		description: 'text-red-900/80 dark:text-red-100/80',
		Icon: ShieldAlert,
	},
} as const;

/**
 * Shown while the payment gate refuses something: the remote prompts switch is closed, or
 * the chain disagrees with the token this build is for, or both, the switch first (see
 * `gateCopy`). Paying actions are switched off for as long as it shows, so it offers
 * nothing to click: hiding it would leave disabled controls with no explanation. It goes
 * away by itself when the switch reopens or a later check passes. Every word comes from the
 * app; nothing written in the switch document is shown.
 */
export default function PaymentsSwitchedOffBanner({ className }: PaymentsSwitchedOffBannerProps) {
	const { state } = usePaymentGate();
	const notices = gateCopy(state, FEE_TOKEN.symbol);
	if (notices.length === 0) return null;
	const isSwitchClosed = state.prompts.status === 'closed';

	return (
		<>
			{notices.map((notice, index) => {
				const kind = isSwitchClosed && index === 0 ? 'switch' : 'feeToken';
				const { alert, description, Icon } = TONE[kind];
				return (
					<Alert key={kind} className={cn(alert, className)}>
						<Icon className="size-4" />
						<AlertTitle>{notice.title}</AlertTitle>
						<AlertDescription className={description}>{notice.description}</AlertDescription>
					</Alert>
				);
			})}
		</>
	);
}
