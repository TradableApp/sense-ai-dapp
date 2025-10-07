import { useState } from 'react';

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import OfflineCloudIcon from './icons/OfflineCloudIcon';

export default function OfflineMessage() {
	const [isHidden, setIsHidden] = useState(false);

	if (isHidden) {
		return null;
	}

	return (
		<div className="fixed bottom-4 left-4 z-50">
			<Card className="w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-5 bg-destructive/10 border-destructive/30 text-destructive-foreground">
				<CardContent className="p-4">
					<div className="flex items-center gap-4">
						<OfflineCloudIcon className="size-8 shrink-0 text-destructive" />
						<div className="flex-grow">
							<h3 className="font-semibold">No Internet Connection</h3>
							<p className="text-sm text-destructive-foreground/80">
								Please check your network settings.
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => setIsHidden(true)}
							aria-label="Dismiss offline message"
						>
							<X className="size-4" />
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
