import { UserRound } from 'lucide-react';
import { ConnectButton } from 'thirdweb/react';

import { Button } from '@/components/ui/button';
import { client, wallets } from '@/config/thirdweb';
import senseaiLogo from '@/senseai-logo.svg';

export default function Header() {
	return (
		<header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="container flex h-14 items-center">
				<div className="mr-4 flex">
					<a href="/" className="mr-6 flex items-center space-x-2">
						<img src={senseaiLogo} alt="SenseAI" className="h-6 w-6" />
					</a>
				</div>

				<div className="flex flex-1 items-center justify-end space-x-2">
					<ConnectButton client={client} wallets={wallets} theme="dark" />
					<Button variant="ghost" size="icon">
						<UserRound className="h-5 w-5" />
					</Button>
				</div>
			</div>
		</header>
	);
}
