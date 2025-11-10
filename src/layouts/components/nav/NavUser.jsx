import { ConnectButton } from 'thirdweb/react';

import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { client, localChain, wallets } from '@/config/thirdweb';

export default function NavUser() {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<ConnectButton
					client={client}
					wallets={wallets}
					chains={[localChain]}
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
