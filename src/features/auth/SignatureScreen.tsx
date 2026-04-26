import { Loader2, ShieldCheck } from 'lucide-react';
import { ConnectButton } from 'thirdweb/react';

import RainbowButton from '@/components/magicui/rainbow-button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import Separator from '@/components/ui/separator';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';
import senseaiLogo from '@/senseai-logo.svg';

import { useSession } from './SessionProvider';

export default function SignatureScreen({ onRetry }) {
	const { status } = useSession();

	const isLoading = status === 'deriving';
	const hasError = status === 'rejected' || status === 'error';

	return (
		<main className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
			<Card className="w-full max-w-[400px] animate-in fade-in-0 zoom-in-95 rounded-xl bg-[hsl(230_11.63%_8.43%)] border-[hsl(230_11.63%_17%)] text-white">
				<CardHeader className="p-4">
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
				</CardHeader>
				<Separator className="bg-[hsl(230_11.63%_17%)]" />
				<CardContent className="pt-6 text-center">
					<div className="flex justify-center">
						<div className="flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
							<ShieldCheck className="size-4" />
							<span>Enable End-to-End Encryption</span>
						</div>
					</div>
					<p className="text-sm text-[#eeeef0] mt-4 px-2">
						To protect your conversations, SenseAI requires a one-time signature to generate your
						private, session-only encryption key.
					</p>
					<p className="text-xs text-muted-foreground/60 text-center mt-4">
						This is a free, gas-less action and does not grant any transaction permissions.
					</p>
				</CardContent>
				<CardFooter className="flex flex-col gap-4 px-6 pb-6">
					{isLoading && (
						<div className="flex h-11 items-center text-muted-foreground">
							<Loader2 className="mr-2 size-4 animate-spin" />
							Waiting for signature in your wallet...
						</div>
					)}
					{hasError && (
						<>
							<p className="text-sm text-destructive text-center">
								{status === 'rejected'
									? 'Signature was declined. A signature is required to protect your data and continue.'
									: 'An unexpected error occurred. Please try again.'}
							</p>
							<RainbowButton className="w-full" onClick={onRetry}>
								Try Again
							</RainbowButton>
						</>
					)}
				</CardFooter>
			</Card>
		</main>
	);
}
