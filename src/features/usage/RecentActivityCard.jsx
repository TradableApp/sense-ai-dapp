import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import Separator from '@/components/ui/separator';
import Skeleton from '@/components/ui/skeleton';
import useRecentActivity from '@/hooks/useRecentActivity';

export default function RecentActivityCard() {
	const { data: activities, isLoading } = useRecentActivity(20);

	return (
		<Card className="flex flex-col border-border/30 bg-background shadow-lg">
			<CardHeader>
				<CardTitle>Recent Activity</CardTitle>
				<CardDescription>A log of your recent on-chain actions.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 min-h-0 p-0">
				<ScrollArea className="h-[300px] md:h-[400px] px-6">
					<div className="space-y-4 py-4">
						{isLoading && (
							<>
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
							</>
						)}
						{!isLoading && (!activities || activities.length === 0) && (
							<p className="text-center text-sm text-muted-foreground py-8">No recent activity.</p>
						)}
						{!isLoading &&
							activities &&
							activities.map((item, index) => (
								<div key={item.id}>
									<div className="flex items-center gap-4">
										<item.icon className="h-5 w-5 text-muted-foreground shrink-0" />
										<div className="flex-grow min-w-0">
											<p className="font-medium truncate">{item.label}</p>
											<p className="text-sm text-muted-foreground">{item.formattedTimestamp}</p>
										</div>
										<div
											className={`font-medium whitespace-nowrap ${
												Number(item.formattedAmount) > 0 ? 'text-green-500' : ''
											}`}
										>
											{Number(item.formattedAmount) === 0
												? ''
												: `${Number(item.formattedAmount).toFixed(1)} ABLE`}
										</div>
									</div>
									{index < activities.length - 1 && <Separator className="mt-4" />}
								</div>
							))}
					</div>
				</ScrollArea>
			</CardContent>
			<CardFooter className="pt-4 border-t bg-muted/5">
				<Button variant="ghost" className="w-full text-primary" disabled>
					View All Activity (Coming Soon)
				</Button>
			</CardFooter>
		</Card>
	);
}
