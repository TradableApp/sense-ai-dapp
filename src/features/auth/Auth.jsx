import { Navigate } from 'react-router-dom';
import { ConnectButton, useActiveAccount } from 'thirdweb/react';

import RainbowLabel from '@/components/magicui/rainbow-label';
import { client, wallets } from '@/config/thirdweb';
import senseaiLogo from '@/senseai-logo.svg';
import senseaiTextLogoBlack from '@/senseai-text-logo-black-purple.svg';
import senseaiTextLogoWhite from '@/senseai-text-logo-white-purple.svg';

export default function Auth() {
	const account = useActiveAccount();

	if (account) {
		return <Navigate to="/" replace />;
	}

	return (
		<main className="min-h-screen flex flex-col items-center justify-center p-4">
			<div className="flex flex-col items-center text-center mb-10">
				<img
					src={senseaiLogo}
					alt="SenseAI logo"
					className="size-32 md:size-36"
					style={{
						filter: 'drop-shadow(0px 0px 24px rgba(167, 38, 169, 0.4))',
					}}
				/>
				<img
					src={senseaiTextLogoBlack}
					alt="SenseAI"
					className="block dark:hidden w-64 md:w-80 mt-6"
				/>
				<img
					src={senseaiTextLogoWhite}
					alt="SenseAI"
					className="hidden dark:block w-64 md:w-80 mt-6"
				/>
			</div>

			<ConnectButton
				client={client}
				wallets={wallets}
				appMetadata={{
					name: 'SenseAI App',
					url: 'https://tradable.app',
				}}
				connectButton={{
					label: <RainbowLabel>Connect Wallet</RainbowLabel>,
					style: { padding: 0, height: 'fit-content', background: 'none' },
				}}
			/>
		</main>
	);
}
