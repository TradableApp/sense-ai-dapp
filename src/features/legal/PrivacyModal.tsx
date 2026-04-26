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

import PrivacyPolicyDoc from './docs/PrivacyPolicyDoc';

export default function PrivacyModal() {
	const dispatch = useDispatch();
	const isOpen = useSelector(state => state.ui.currentModal.type === 'Privacy');

	return (
		<Dialog open={isOpen} onOpenChange={() => dispatch(closeModal())}>
			<DialogContent className="w-full max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Privacy Policy</DialogTitle>
					<DialogDescription>Our commitment to your privacy.</DialogDescription>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh] pr-6">
					<PrivacyPolicyDoc />
				</ScrollArea>
				<DialogFooter>
					<Button onClick={() => dispatch(closeModal())}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
