import {
	FilePenLine,
	MessageSquare,
	MoreHorizontal,
	PlusCircle,
	Search,
	Share2,
	Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Input from '@/components/ui/input';

// Mock data with longer previews and a very long name to test truncation.
const historyItems = [
	{
		id: '1',
		name: 'A Very Long Conversation Name to Test Truncation and Ensure the Layout Does Not Break on Smaller Screens',
		lastMessagePreview:
			"Excellent. Let's make the chat area scrollable on desktop, it's currently causing the whole page to scroll.",
		updated: '7 minutes ago',
	},
	{
		id: '2',
		name: 'Bitcoin On-Chain Analysis',
		lastMessagePreview:
			'The current sentiment for Bitcoin is cautiously optimistic. We are seeing positive momentum in several key metrics.',
		updated: '1 hour ago',
	},
	{
		id: '3',
		name: 'Ethereum EIP-7702 Impact',
		lastMessagePreview:
			'An upcoming significant event for Ethereum is the EIP-7702 proposal. This aims to improve account abstraction.',
		updated: '4 days ago',
	},
	{
		id: '4',
		name: 'Market Sentiment Check',
		lastMessagePreview:
			'Sure, I can provide a market sentiment overview. Which assets are you most interested in right now?',
		updated: '5 days ago',
	},
	{
		id: '5',
		name: 'Tokenomics Review And Recommendations',
		lastMessagePreview:
			'After analyzing the whitepaper, the tokenomics appear solid. However, the vesting schedule could be more transparent.',
		updated: '6 days ago',
	},
	{
		id: '6',
		name: 'SenseAI Telegram Integration Research',
		lastMessagePreview:
			'To integrate with Telegram, we will need to use their Bot API. Authentication can be handled via a custom deep link.',
		updated: '1 week ago',
	},
	{
		id: '7',
		name: 'Crypto.com API Integration Plan',
		lastMessagePreview:
			'We need to define the scope for the Crypto.com API integration. Let us start with fetching user balances and transaction history.',
		updated: '2 weeks ago',
	},
	{
		id: '8',
		name: 'AgenticOS for X Account Control',
		lastMessagePreview:
			'The AgenticOS framework could be a good fit for managing social media. It provides robust tools for scheduling posts.',
		updated: '2 weeks ago',
	},
	{
		id: '9',
		name: 'Sitemap Generation For React App',
		lastMessagePreview:
			'I have generated a sitemap.xml file for the new React application. It includes all of the public-facing routes.',
		updated: '3 weeks ago',
	},
	{
		id: '10',
		name: 'Add Base Wallet Integration Plan',
		lastMessagePreview:
			'Here is the plan for integrating Base wallet support into the dApp. We will use the standard EIP-1193 provider interface.',
		updated: '3 weeks ago',
	},
];

export default function History() {
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-2xl font-bold">Conversations</h2>
				<p className="text-muted-foreground">
					Select a conversation to continue where you left off.
				</p>
			</div>

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
					<Input
						type="search"
						placeholder="Search history..."
						className="w-full rounded-lg bg-background pl-8"
					/>
				</div>
				<Button asChild className="items-center gap-1">
					<Link to="/chat">
						<PlusCircle className="size-3.5" />
					</Link>
				</Button>
			</div>

			<div className="overflow-hidden rounded-xl border">
				{/* Desktop Header */}
				<div className="hidden items-center border-b bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground md:flex">
					<div className="flex-1">Name</div>
					<div className="flex-1">Preview</div>
					<div className="w-32 flex-shrink-0 text-right">Updated</div>
					<div className="w-10 flex-shrink-0" />
				</div>

				{/* List of Conversations */}
				<div>
					{historyItems.map(item => (
						<div
							key={item.id}
							className="flex items-center gap-3 border-b p-4 text-sm last:border-b-0"
						>
							<MessageSquare className="size-5 flex-shrink-0 text-muted-foreground" />

							{/* Name + Previews (Mobile and Desktop) */}
							<div className="flex-1 min-w-0">
								<p className="font-medium truncate">{item.name}</p>
								<p className="mt-1 hidden truncate text-muted-foreground md:block">
									{item.lastMessagePreview}
								</p>
								<div className="md:hidden">
									<p className="mt-1 truncate text-xs text-muted-foreground">
										{item.lastMessagePreview}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">{item.updated}</p>
								</div>
							</div>

							{/* Updated Timestamp (Desktop only) */}
							<div className="hidden w-32 flex-shrink-0 text-right text-muted-foreground md:block">
								{item.updated}
							</div>

							{/* Actions Menu (Always Visible) */}
							<div className="flex-shrink-0">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button aria-haspopup="true" size="icon" variant="ghost">
											<MoreHorizontal className="size-4" />
											<span className="sr-only">Toggle menu</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuLabel>Actions</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<DropdownMenuItem>
											<FilePenLine className="mr-2 size-4" />
											Rename
										</DropdownMenuItem>
										<DropdownMenuItem>
											<Share2 className="mr-2 size-4" />
											Share
										</DropdownMenuItem>
										<DropdownMenuItem className="text-destructive">
											<Trash2 className="mr-2 size-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
