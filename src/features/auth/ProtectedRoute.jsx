import { Navigate } from 'react-router-dom';
import { useActiveWallet } from 'thirdweb/react';
import { inAppWallet } from 'thirdweb/wallets';

import SplashScreen from '@/components/SplashScreen';
import MainLayout from '@/layouts/MainLayout';

import { useSession } from './SessionProvider';
import SignatureScreen from './SignatureScreen';

const IN_APP_WALLET_ID = inAppWallet().id;

export default function ProtectedRoute() {
	const activeWallet = useActiveWallet();
	const { sessionKey, status, retry } = useSession();

	// 1. If there's no wallet connected at all, redirect to the auth page.
	if (!activeWallet) {
		return <Navigate to="/auth" replace />;
	}

	// 2. If the session is fully authenticated and ready, show the main app.
	if (status === 'ready' && sessionKey) {
		return <MainLayout />;
	}

	// 3. Handle the In-App Wallet case: it's fast and automatic.
	// We just show a splash screen while the key is derived silently.
	if (activeWallet.id === IN_APP_WALLET_ID) {
		if (status === 'deriving' || status === 'disconnected') {
			return <SplashScreen />;
		}
	}

	// 4. Handle all other wallets (MetaMask, etc.) that require a signature.
	// This renders our new full-page blocker, passing only the retry function.
	return <SignatureScreen onRetry={retry} />;
}
