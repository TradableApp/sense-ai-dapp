import { Navigate } from 'react-router-dom';
import { ConnectButton, useActiveAccount } from 'thirdweb/react';

import senseaiTextLogoBlack from '@/assets/logos/senseai-logo-full-black.svg';
import senseaiTextLogoWhite from '@/assets/logos/senseai-logo-full-white.svg';
import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import TradableLogo from '@/components/icons/TradableLogo';
import XLogo from '@/components/icons/XLogo';
import RainbowLabel from '@/components/magicui/rainbow-label';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';
import { useAppDispatch } from '@/store/hooks';
import { openModal } from '@/store/uiSlice';

interface FooterLinkProps {
	label: string;
	onClick: () => void;
}

function FooterLink({ label, onClick }: FooterLinkProps) {
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
	const activeAccount = useActiveAccount();
	const dispatch = useAppDispatch();

	if (activeAccount) {
		return <Navigate to="/" replace />;
	}

	return (
		<main className="min-h-screen flex flex-col items-center justify-center p-4">
			<div className="flex-1 flex flex-col items-center justify-center text-center">
				<div className="relative isolate max-w-full px-6 py-8">
					<div
						aria-hidden="true"
						className="absolute inset-x-0 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,rgba(153,57,241,0.28),rgba(153,57,241,0))]"
					/>
					<img
						src={senseaiTextLogoBlack}
						alt="SenseAI"
						className="block dark:hidden w-72 md:w-96"
					/>
					<img
						src={senseaiTextLogoWhite}
						alt="SenseAI"
						className="hidden dark:block w-72 md:w-96"
					/>
				</div>
				<div className="mt-10">
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
						connectButton={{
							label: <RainbowLabel>Connect Wallet</RainbowLabel>,
							style: { padding: 0, height: 'fit-content', background: 'none' },
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
