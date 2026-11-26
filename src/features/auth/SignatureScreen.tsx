import { Loader2, ShieldCheck } from 'lucide-react';
import { ConnectButton } from 'thirdweb/react';

import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import RainbowButton from '@/components/magicui/rainbow-button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SUPPORTED_TOKENS } from '@/config/contracts';
import { client, deploymentChain, wallets } from '@/config/thirdweb';
import { DISPLAY_BALANCE_TOKEN, WALLET_DETAILS_MODAL } from '@/config/walletPanel';
import { sessionSiteFor } from '@/features/auth/sessionMessage';

import { useSession } from './SessionProvider';

// The host the signed message names (sessionMessage.ts), so the user can match the two.
const SESSION_SITE = sessionSiteFor(import.meta.env.MODE);
const SESSION_HOST = SESSION_SITE ? new URL(SESSION_SITE).host : undefined;

interface SignatureScreenProps {
	onRetry: () => void;
}

export default function SignatureScreen({ onRetry }: SignatureScreenProps) {
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
							displayBalanceToken: DISPLAY_BALANCE_TOKEN,
						}}
						detailsModal={WALLET_DETAILS_MODAL}
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
					{SESSION_HOST && (
						<p className="text-sm text-[#eeeef0] mt-3 px-2" data-testid="session-message-site">
							If your wallet shows the message before you sign, check that it names {SESSION_HOST},
							and sign it only while you are on {SESSION_HOST}. A wallet you sign in to with email,
							a social account or a passkey signs it without showing it.
						</p>
					)}
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
					{status === 'wrong-site' && SESSION_SITE && (
						<p className="text-sm text-[#eeeef0] text-center" data-testid="wrong-site">
							SenseAI is at{' '}
							<a
								href={SESSION_SITE}
								className="font-medium text-green-400 underline underline-offset-4"
							>
								{SESSION_HOST}
							</a>
							. Open it there to unlock your history: no signature is asked for on this page.
						</p>
					)}
					{status === 'unsupported-wallet' && (
						<p className="text-sm text-destructive text-center" data-testid="unsupported-wallet">
							This wallet cannot create the key that protects your history: it signs in a way that
							gives a different key each time, or it signed for another account. Please connect
							another wallet.
						</p>
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
