import { useDispatch } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { ConnectButton, useActiveAccount } from 'thirdweb/react';

import TradableLogo from '@/components/icons/TradableLogo';
import XLogo from '@/components/icons/XLogo';
import RainbowLabel from '@/components/magicui/rainbow-label';
import { client, wallets } from '@/config/thirdweb';
import senseaiLogo from '@/senseai-logo.svg';
import senseaiTextLogoBlack from '@/senseai-text-logo-black-purple.svg';
import senseaiTextLogoWhite from '@/senseai-text-logo-white-purple.svg';
import { openModal } from '@/store/uiSlice';

function FooterLink({ label, onClick }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="text-xs text-muted-foreground transition-colors hover:text-foreground"
		>
			{label}
		</button>
	);
}

export default function Auth() {
	const account = useActiveAccount();
	const dispatch = useDispatch();

	if (account) {
		return <Navigate to="/" replace />;
	}

	return (
		<main className="min-h-screen flex flex-col items-center justify-center p-4">
			<div className="flex-1 flex flex-col items-center justify-center text-center">
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
				<div className="mt-10">
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
				</div>
			</div>

			<footer className="w-full flex flex-col items-center gap-4 py-8">
				{/* Row 1: Social and External Links */}
				<div className="flex items-center gap-6">
					<a
						href="https://tradable.app"
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Visit Tradable"
					>
						{/* We explicitly request the 'monochrome' variant for the footer */}
						<TradableLogo variant="monochrome" className="size-5" />
					</a>
					<a
						href="https://x.com/SenseAI_agent"
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Visit our page on X"
					>
						<XLogo className="size-4" />
					</a>
				</div>

				{/* Row 2: Legal and Support Links */}
				<div className="flex items-center flex-wrap justify-center gap-x-6 gap-y-2">
					<FooterLink label="Support" onClick={() => dispatch(openModal({ type: 'Support' }))} />
					<FooterLink label="Terms" onClick={() => dispatch(openModal({ type: 'Terms' }))} />
					<FooterLink label="Privacy" onClick={() => dispatch(openModal({ type: 'Privacy' }))} />
					<FooterLink
						label="Disclaimer"
						onClick={() => dispatch(openModal({ type: 'Disclaimer' }))}
					/>
				</div>

				<p className="text-xs text-muted-foreground/50">
					&copy; {new Date().getFullYear()} SenseAI. All Rights Reserved.
				</p>
			</footer>
		</main>
	);
}
