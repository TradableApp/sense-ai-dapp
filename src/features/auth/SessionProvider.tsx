import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

import { useActiveAccount, useActiveWallet } from 'thirdweb/react';
import { signMessage } from 'thirdweb/utils';
import type { Wallet } from 'thirdweb/wallets';

import { deriveKeyFromEntropy } from '@/lib/crypto';
import { clearUserSession } from '@/store/chatSlice';
import { useAppDispatch } from '@/store/hooks';

import needsSessionDerivation from './sessionDerivation';

type SessionStatus = 'disconnected' | 'deriving' | 'ready' | 'rejected' | 'error';

interface SessionContextValue {
	sessionKey: CryptoKey | null;
	status: SessionStatus;
	activeWallet: Wallet | undefined;
	ownerAddress: string | null;
	retry: () => void;
}

const SessionContext = createContext<SessionContextValue>({
	sessionKey: null,
	status: 'disconnected',
	activeWallet: undefined,
	ownerAddress: null,
	retry: () => {},
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

export default function SessionProvider({ children }: { children: ReactNode }) {
	const activeWallet = useActiveWallet();
	// useActiveAccount (not activeWallet.getAccount()) so the derivation effect actually re-runs
	// when the user switches accounts in their wallet — the wallet object is stable across that
	// switch, so depending on it alone would never react to the account change.
	const account = useActiveAccount();
	const dispatch = useAppDispatch();
	const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
	const [status, setStatus] = useState<SessionStatus>('disconnected');
	const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
	const [retryCount, setRetryCount] = useState(0);

	// Use our new custom hook to get the tab's visibility status.
	const isTabVisible = usePageVisibility();

	const retry = useCallback(() => setRetryCount(prev => prev + 1), []);

	useEffect(() => {
		const generateKey = async () => {
			// --- GUARD CLAUSE 1: NO CONNECTED ACCOUNT ---
			// If no wallet/account is connected, reset everything and stop.
			if (!account) {
				setSessionKey(null);
				setOwnerAddress(null);
				setStatus('disconnected');
				return;
			}

			// --- GUARD CLAUSE 2: KEY ALREADY MATCHES THIS ACCOUNT ---
			// A key derived for the CURRENTLY connected account → ready. Still avoids re-signing on
			// every tab refocus, but (unlike the old "any key exists" check) it re-derives when the
			// user switches accounts — otherwise the previous account's key, and its decrypted data,
			// would persist under the new account (see sessionDerivation + the T-MULTI-07 bug).
			if (!needsSessionDerivation(!!sessionKey, ownerAddress, account.address)) {
				setStatus('ready');
				return;
			}

			// --- GUARD CLAUSE 3: TAB IS HIDDEN ---
			// Connected but with no usable key for this account, and the tab isn't visible — wait
			// (don't prompt a signature). The effect re-runs when the tab becomes visible.
			if (!isTabVisible) {
				return;
			}

			// A key for a DIFFERENT account means the user switched wallets: wipe the prior account's
			// in-memory chat state before deriving the new one. Setting ownerAddress below immediately
			// re-scopes the owner-keyed queries to the new account, and the session key is overwritten
			// once derivation completes — so the old account's data is never shown under the new one.
			const isAccountSwitch = !!sessionKey && ownerAddress !== account.address;
			if (isAccountSwitch) {
				dispatch(clearUserSession());
			}

			try {
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
				const errorMessage = error instanceof Error ? error.message : String(error);
				if (errorMessage.toLowerCase().includes('user rejected')) {
					setStatus('rejected');
				} else {
					setStatus('error');
				}
			}
		};

		generateKey();
		// Depends on `account` (whose reference changes on an in-wallet account switch — unlike the
		// stable wallet object) so derivation re-runs on a switch, plus the other read values.
	}, [account, sessionKey, ownerAddress, isTabVisible, dispatch, retryCount]);

	const value = useMemo(
		() => ({ sessionKey, status, activeWallet, ownerAddress, retry }),
		[sessionKey, status, activeWallet, ownerAddress, retry],
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
