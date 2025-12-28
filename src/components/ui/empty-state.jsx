import { PlusCircle } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import senseaiLogo from '@/senseai-logo.svg';
import { setActiveConversationId } from '@/store/chatSlice';

export default function EmptyState() {
	const dispatch = useDispatch();

	return (
		<div className="flex flex-col items-center justify-center text-center p-4 space-y-4">
			<div className="flex h-full flex-col items-center justify-center text-center p-4">
				<img src={senseaiLogo} alt="SenseAI" className="size-24 mb-4" />
				<h2 className="text-xl font-semibold">No Conversations Yet</h2>
				<p className="text-muted-foreground max-w-sm mx-auto">
					Start a new chat to see your history here.
				</p>
			</div>

			<Button
				asChild
				className="items-center gap-2"
				onClick={() => dispatch(setActiveConversationId(null))}
			>
				<Link to="/chat">
					<PlusCircle className="size-4" />
					New Chat
				</Link>
			</Button>
		</div>
	);
}
