import { ConnectButton } from 'thirdweb/react';

import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';

export default function NavUser() {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<ConnectButton
					client={client}
					wallets={wallets}
					chains={[deploymentChain]}
					supportedTokens={SUPPORTED_TOKENS}
					appMetadata={{
						name: 'SenseAI App',
						url: 'https://tradable.app',
					}}
					theme="dark"
					connectButton={{
						className: '!w-full',
					}}
					detailsButton={{
						className: '!w-full',
					}}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
