import { useDispatch, useSelector } from 'react-redux';

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
import { closeModal } from '@/store/uiSlice';

import WebsiteDisclaimerDoc from './docs/WebsiteDisclaimerDoc';

export default function DisclaimerModal() {
	const dispatch = useDispatch();
	const isOpen = useSelector(state => state.ui.currentModal.type === 'Disclaimer');

	return (
		<Dialog open={isOpen} onOpenChange={() => dispatch(closeModal())}>
			<DialogContent className="w-full max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Disclaimer</DialogTitle>
					<DialogDescription>Important information about your use of SenseAI.</DialogDescription>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh] pr-6">
					<WebsiteDisclaimerDoc />
				</ScrollArea>
				<DialogFooter>
					<Button onClick={() => dispatch(closeModal())}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
