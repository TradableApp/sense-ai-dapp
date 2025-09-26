import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { useActiveWallet } from 'thirdweb/react';
import { signMessage } from 'thirdweb/utils';
import { inAppWallet } from 'thirdweb/wallets';

import { deriveKeyFromEntropy } from '@/lib/crypto';

const IN_APP_WALLET_ID = inAppWallet().id;

const SessionContext = createContext({
	sessionKey: null,
	status: 'disconnected',
	activeWallet: null,
	ownerAddress: null,
	retry: () => {}, // Add retry function to the context
});

export const useSession = () => useContext(SessionContext);

export default function SessionProvider({ children }) {
	const activeWallet = useActiveWallet();
	const [sessionKey, setSessionKey] = useState(null);
	const [status, setStatus] = useState('disconnected');
	const [ownerAddress, setOwnerAddress] = useState(null);
	const [retryCount, setRetryCount] = useState(0);

	const retry = () => setRetryCount(prev => prev + 1);

	useEffect(() => {
		const generateKey = async () => {
			if (!activeWallet) {
				setSessionKey(null);
				setOwnerAddress(null);
				setStatus('disconnected');
				return;
			}

			const account = activeWallet.getAccount();
			if (!account) {
				setStatus('error');
				console.error('Wallet connected but account not found.');
				return;
			}

			try {
				setStatus('deriving');
				setOwnerAddress(account.address);

				let entropy;
				if (activeWallet.id === IN_APP_WALLET_ID) {
					const auth = await activeWallet.getAuthDetails();
					entropy = auth.token;
				} else {
					const SIGNATURE_MESSAGE =
						'Login to SenseAI to encrypt and decrypt your local conversation history.';
					entropy = await signMessage({
						account,
						message: SIGNATURE_MESSAGE,
					});
				}

				const derivedKey = await deriveKeyFromEntropy(entropy);
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
	}, [activeWallet, retryCount]); // Re-run when retryCount changes

	const value = useMemo(
		() => ({ sessionKey, status, activeWallet, ownerAddress, retry }),
		[sessionKey, status, activeWallet, ownerAddress],
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
