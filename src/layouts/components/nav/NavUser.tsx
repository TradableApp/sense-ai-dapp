import { ConnectButton } from 'thirdweb/react';

import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';
import senseaiLogo from '@/senseai-logo.svg';

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
						displayBalanceToken: {
							[import.meta.env.VITE_CHAIN_ID]: import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS,
							// You can add more chains and tokens here if needed
							// [otherChain.id]: "0x...",
						},
					}}
					detailsModal={{
						showTestnetFaucet: true,
					}}
					theme="dark"
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
