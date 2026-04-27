import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { closeModal } from '@/store/uiSlice';

import TermsAndConditionsDoc from './docs/TermsAndConditionsDoc';

export default function TermsModal() {
	const dispatch = useAppDispatch();
	const isOpen = useAppSelector(state => state.ui.currentModal.type === 'Terms');

	return (
		<Dialog open={isOpen} onOpenChange={() => dispatch(closeModal(undefined))}>
			<DialogContent className="w-full max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Terms & Conditions</DialogTitle>
					<DialogDescription>
						Please read our terms and conditions carefully before using our service.
					</DialogDescription>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh] pr-6">
					<TermsAndConditionsDoc />
				</ScrollArea>
				<DialogFooter>
					<Button onClick={() => dispatch(closeModal(undefined))}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
