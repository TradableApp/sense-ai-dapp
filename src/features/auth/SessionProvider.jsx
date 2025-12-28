import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { useActiveWallet } from 'thirdweb/react';
import { signMessage } from 'thirdweb/utils';

import { deriveKeyFromEntropy } from '@/lib/crypto';

const SessionContext = createContext({
	sessionKey: null,
	status: 'disconnected',
	activeWallet: null,
	ownerAddress: null,
	retry: () => {}, // Add retry function to the context
});

export const useSession = () => useContext(SessionContext);

// This is the single, unchanging message that will be signed by all users.
// It acts as the "password" for key derivation.
const SIGNATURE_MESSAGE =
	'Login to SenseAI to encrypt and decrypt your local conversation history.';

/**
 * A custom hook that tracks whether the current browser tab is visible.
 * @returns {boolean} True if the page is visible, false otherwise.
 */
const usePageVisibility = () => {
	const [isTabVisible, setIsTabVisible] = useState(!document.hidden);

	useEffect(() => {
		const handleVisibilityChange = () => {
			setIsTabVisible(!document.hidden);
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, []);

	return isTabVisible;
};

export default function SessionProvider({ children }) {
	const activeWallet = useActiveWallet();
	const [sessionKey, setSessionKey] = useState(null);
	const [status, setStatus] = useState('disconnected');
	const [ownerAddress, setOwnerAddress] = useState(null);
	const [retryCount, setRetryCount] = useState(0);

	// Use our new custom hook to get the tab's visibility status.
	const isTabVisible = usePageVisibility();

	const retry = () => setRetryCount(prev => prev + 1);

	useEffect(() => {
		const generateKey = async () => {
			console.log('Running generateKey');

			// --- GUARD CLAUSE 1: NO WALLET ---
			// If no wallet is connected, reset everything and stop.
			if (!activeWallet) {
				setSessionKey(null);
				setOwnerAddress(null);
				setStatus('disconnected');
				return;
			}

			// --- GUARD CLAUSE 2: KEY ALREADY EXISTS ---
			// If we already have a session key, we don't need to do anything.
			// This prevents asking for a signature again on every tab refocus.
			if (sessionKey) {
				setStatus('ready');
				return;
			}

			// --- GUARD CLAUSE 3: TAB IS HIDDEN ---
			// If a wallet is connected but the tab is not visible, we wait.
			// We do NOT request a signature. The effect will re-run when the tab becomes visible.
			if (!isTabVisible) {
				console.log(
					'[SessionProvider] Wallet connected, but tab is hidden. Deferring signature request.',
				);
				return;
			}

			// --- PROCEED WITH SIGNATURE ---
			// If all guards are passed, it means we have a wallet, no key, and a visible tab.
			const account = activeWallet.getAccount();
			if (!account) {
				setStatus('error');
				console.error('Wallet connected but account not found.');
				return;
			}

			try {
				console.log('[SessionProvider] Tab is visible and key is needed. Requesting signature...');
				setStatus('deriving');
				setOwnerAddress(account.address);

				const entropy = await signMessage({
					account,
					message: SIGNATURE_MESSAGE,
				});

				const derivedKey = await deriveKeyFromEntropy(entropy, account.address);

				setSessionKey(derivedKey);
				setStatus('ready');
			} catch (error) {
				console.error('Failed to derive session key:', error);
				setSessionKey(null);
				if (error.message.toLowerCase().includes('user rejected')) {
					setStatus('rejected');
				} else {
					setStatus('error');
				}
			}
		};

		generateKey();
		// The effect now depends on tab visibility. It will re-run when the user
		// clicks back to this tab, allowing the guards to be checked again.
	}, [activeWallet, retryCount, isTabVisible, sessionKey]);

	const value = useMemo(
		() => ({ sessionKey, status, activeWallet, ownerAddress, retry }),
		[sessionKey, status, activeWallet, ownerAddress],
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
