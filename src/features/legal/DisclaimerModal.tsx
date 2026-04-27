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

import WebsiteDisclaimerDoc from './docs/WebsiteDisclaimerDoc';

export default function DisclaimerModal() {
	const dispatch = useAppDispatch();
	const isOpen = useAppSelector(state => state.ui.currentModal.type === 'Disclaimer');

	return (
		<Dialog open={isOpen} onOpenChange={() => !isOpen && dispatch(closeModal(undefined))}>
			<DialogContent className="w-full max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Disclaimer</DialogTitle>
					<DialogDescription>Important information about your use of SenseAI.</DialogDescription>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh] pr-6">
					<WebsiteDisclaimerDoc />
				</ScrollArea>
				<DialogFooter>
					<Button onClick={() => dispatch(closeModal(undefined))}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
