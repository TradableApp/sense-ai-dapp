import { ConnectButton } from 'thirdweb/react';

import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';
import { DISPLAY_BALANCE_TOKEN, WALLET_DETAILS_MODAL } from '@/config/walletPanel';

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
						description: 'Tokenized AI Agent',
						logoUrl: senseaiLogo,
					}}
					detailsButton={{
						className: '!w-full',
						displayBalanceToken: DISPLAY_BALANCE_TOKEN,
					}}
					detailsModal={WALLET_DETAILS_MODAL}
					theme="dark"
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
