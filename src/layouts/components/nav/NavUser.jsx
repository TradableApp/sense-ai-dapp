import { ConnectButton } from 'thirdweb/react';

import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { client, wallets } from '@/config/thirdweb';

export default function NavUser() {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<ConnectButton
					client={client}
					wallets={wallets}
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
