import { ArrowRight, Repeat, ShieldCheck, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const features = [
	{
		icon: Wallet,
		title: 'Set a Limit',
		description: 'Approve how many ABLE tokens your AI agent can use. No surprises.',
	},
	{
		icon: Repeat,
		title: 'One-Time Approval',
		description: 'No subscriptions. You’re always in control.',
	},
	{
		icon: ShieldCheck,
		title: 'Change Anytime',
		description: 'Adjust or revoke your limit directly from the Dashboard.',
	},
];

export default function OnboardingCard({ onGetStarted }) {
	return (
		<Card className="m-8 w-full max-w-md rounded-2xl border border-border/40 bg-gradient-to-b from-background via-background/95 to-muted p-4 shadow-lg sm:p-6">
			<CardHeader className="space-y-2 text-center">
				<CardTitle className="text-2xl font-semibold tracking-tight">
					Activate Your AI Agent
				</CardTitle>
				<p className="text-sm text-foreground/70">
					A quick one-time setup to start your conversations.
				</p>
			</CardHeader>

			<CardContent className="space-y-4 pt-2" style={{ padding: 0 }}>
				<div className="flex flex-col gap-3">
					{features.map(({ icon: Icon, title, description }) => (
						<div key={title} className="flex items-center gap-4 rounded-xl bg-muted/40 p-4">
							<div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
								<Icon className="h-5 w-5 text-primary" />
							</div>
							<div className="text-left">
								<p className="font-medium">{title}</p>
								<p className="text-sm text-muted-foreground">{description}</p>
							</div>
						</div>
					))}
				</div>
			</CardContent>

			<CardFooter className="pt-4">
				<Button className="group h-11 w-full text-base font-medium" onClick={onGetStarted}>
					Get Started
					<ArrowRight className="ml-1.5 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
				</Button>
			</CardFooter>
		</Card>
	);
}
