import { useId } from 'react';

import { Loader2 } from 'lucide-react';

import PaymentsSwitchedOffBanner from '@/components/PaymentsSwitchedOffBanner';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import useSwitchedOffReason from '@/hooks/useSwitchedOffReason';
import { cn } from '@/lib/utils';

interface DeleteConversationDialogProps {
	open: boolean;
	onOpenChange: (_open: boolean) => void;
	onConfirm: () => void;
	onCancel: () => void;
	isProcessing: boolean;
}

/**
 * Asks before a conversation is deleted. A delete pays a fee, and the payment gate can
 * switch deletes off while this is open, so the dialog mounts the banner itself (its
 * backdrop hides the page's) and marks Continue switched off: `aria-disabled` with the
 * reason as its description, still focusable, and a click that does nothing and keeps the
 * dialog open.
 */
export default function DeleteConversationDialog({
	open,
	onOpenChange,
	onConfirm,
	onCancel,
	isProcessing,
}: DeleteConversationDialogProps) {
	const deleteSwitchedOff = useSwitchedOffReason('metadata', 'dialog');
	const reasonId = useId();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>
						This will permanently delete this conversation. This action requires a transaction and
						cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<PaymentsSwitchedOffBanner />
				{deleteSwitchedOff && (
					<p id={reasonId} className="text-sm text-muted-foreground">
						{deleteSwitchedOff}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel} disabled={isProcessing}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						className={cn(
							'bg-destructive hover:bg-destructive/90',
							!!deleteSwitchedOff && 'cursor-not-allowed opacity-50',
						)}
						aria-disabled={!!deleteSwitchedOff}
						aria-describedby={deleteSwitchedOff ? reasonId : undefined}
						// A prevented click keeps the dialog open and sends nothing.
						onClick={event => (deleteSwitchedOff ? event.preventDefault() : onConfirm())}
						disabled={isProcessing}
					>
						{isProcessing && <Loader2 className="mr-2 size-4 animate-spin" />}
						Continue
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
