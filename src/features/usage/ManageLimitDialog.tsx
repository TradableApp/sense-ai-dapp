import { useState } from 'react';

import { Settings, Trash2 } from 'lucide-react';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import Input from '@/components/ui/input';
import Label from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Helper to calculate days remaining for the default value
const getDaysRemaining = expiryDate => {
	if (!expiryDate) return 30; // Default to 30 days if none is set
	const now = new Date();
	const differenceInMs = expiryDate.getTime() - now.getTime();
	if (differenceInMs <= 0) return 30; // Default if expired
	return Math.ceil(differenceInMs / (1000 * 60 * 60 * 24));
};

export default function ManageLimitDialog({ plan }) {
	const [isOpen, setIsOpen] = useState(false);
	const { allowance, expiresAt, pendingEscrowCount } = plan;
	const hasPendingPrompts = pendingEscrowCount > 0;

	const handleSaveChanges = () => {
		console.log('Saving changes...');
		setIsOpen(false);
	};

	const handleRevoke = () => {
		console.log('Revoking access...');
	};

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="w-full">
						<Dialog open={isOpen} onOpenChange={setIsOpen}>
							<DialogTrigger asChild>
								<Button
									variant="outline"
									className="h-10 w-full text-base font-medium"
									disabled={hasPendingPrompts}
								>
									<Settings className="mr-2 h-4 w-4" />
									Manage
								</Button>
							</DialogTrigger>
							<DialogContent className="sm:max-w-[425px]">
								<DialogHeader>
									<DialogTitle>Manage Spending Limit</DialogTitle>
									<DialogDescription>
										Set a new limit or revoke access completely. These actions will require a
										transaction.
									</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<div className="grid grid-cols-4 items-center gap-4">
										<Label htmlFor="new-limit" className="text-right">
											New Limit
										</Label>
										<Input id="new-limit" defaultValue={allowance} className="col-span-3" />
									</div>
									<div className="grid grid-cols-4 items-center gap-4">
										<Label htmlFor="expires-in" className="text-right">
											Expires In
										</Label>
										<div className="col-span-3 flex items-center gap-2">
											<Input
												id="expires-in"
												type="number"
												defaultValue={getDaysRemaining(expiresAt)}
											/>
											<span className="text-sm text-muted-foreground">Days</span>
										</div>
									</div>
								</div>
								<DialogFooter className="grid grid-cols-2 gap-2">
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button variant="destructive">
												<Trash2 className="mr-2 h-4 w-4" />
												Revoke Access
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Are you sure?</AlertDialogTitle>
												<AlertDialogDescription>
													This will set your spending limit to 0, completely revoking the AI
													agent&apos;s access to your ABLE tokens. You will need to set a new limit
													to continue using the service.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogAction onClick={handleRevoke}>Confirm Revoke</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
									<Button type="submit" onClick={handleSaveChanges}>
										Save changes
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>
				</TooltipTrigger>
				{hasPendingPrompts && (
					<TooltipContent>
						<p>You cannot change your limit while prompts are pending.</p>
					</TooltipContent>
				)}
			</Tooltip>
		</TooltipProvider>
	);
}
