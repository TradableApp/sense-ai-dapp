import { MessageCircle, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import Separator from '@/components/ui/separator';

// Mock data for recent activity
const mockActivity = [
	{
		type: 'Conversation',
		details: 'Chat with AI Agent',
		amount: -15,
		timestamp: '2 hours ago',
		icon: MessageCircle,
	},
	{
		type: 'Function Call',
		details: 'Executed a complex query',
		amount: -25,
		timestamp: '1 day ago',
		icon: Zap,
	},
	{
		type: 'Conversation',
		details: 'Chat with AI Agent',
		amount: -12,
		timestamp: '2 days ago',
		icon: MessageCircle,
	},
];

export default function RecentActivityCard() {
	return (
		<Card className="mb-8 w-full max-w-md rounded-2xl border-border/30 bg-background shadow-lg">
			<CardHeader>
				<CardTitle>Recent Activity</CardTitle>
				<CardDescription>A log of recent actions performed by the AI agent.</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{mockActivity.map((item, index) => (
						<div key={index}>
							<div className="flex items-center gap-4">
								<item.icon className="h-5 w-5 text-muted-foreground" />
								<div className="flex-grow">
									<p className="font-medium">{item.details}</p>
									<p className="text-sm text-muted-foreground">{item.timestamp}</p>
								</div>
								<div className="font-medium">
									{item.amount} <span className="text-muted-foreground">ABLE</span>
								</div>
							</div>
							{index < mockActivity.length - 1 && <Separator className="mt-4" />}
						</div>
					))}
				</div>
			</CardContent>
			<CardFooter className="pt-4">
				<Button variant="ghost" className="w-full text-primary">
					View All Activity
				</Button>
			</CardFooter>
		</Card>
	);
}
