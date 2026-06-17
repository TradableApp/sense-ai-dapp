import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
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
	// The account address currently being derived for — guards against a second signature prompt
	// when nulling sessionKey on a switch re-runs the effect mid-derivation.
	const derivingForRef = useRef<string | null>(null);

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

			// Already deriving for THIS account — don't start a second signature prompt. Needed
			// because we null sessionKey on a switch (below), and sessionKey is an effect dependency,
			// so that null re-runs the effect mid-derivation; this ref makes the re-run a no-op.
			if (derivingForRef.current === account.address) {
				return;
			}

			// --- GUARD CLAUSE 3: TAB IS HIDDEN ---
			// Connected but with no usable key for this account, and the tab isn't visible — wait
			// (don't prompt a signature). The effect re-runs when the tab becomes visible.
			if (!isTabVisible) {
				return;
			}

			// A key for a DIFFERENT account means the user switched wallets. Drop the prior account's
			// key AND chat state up-front, so the context never exposes a mismatched
			// (account A's key, account B's address) pair during the async derivation window — only a
			// null key + 'deriving' status, which shows nothing of the old account under the new one.
			if (sessionKey) {
				setSessionKey(null);
				dispatch(clearUserSession());
			}

			try {
				// Mark in-flight BEFORE the first await so the re-run triggered by setSessionKey(null)
				// above bails at the guard above instead of double-prompting.
				derivingForRef.current = account.address;
				setStatus('deriving');

				const entropy = await signMessage({
					account,
					message: SIGNATURE_MESSAGE,
				});

				const derivedKey = await deriveKeyFromEntropy(entropy, account.address);

				// Set owner + key together on SUCCESS only. ownerAddress is an effect dependency, so
				// setting it before the await would, on a rejection, change a dep and auto-re-run the
				// effect — silently re-prompting instead of holding the 'rejected' state for the user's
				// Retry. During the derive window sessionKey is null, so no data is shown regardless.
				setSessionKey(derivedKey);
				setOwnerAddress(account.address);
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
			} finally {
				derivingForRef.current = null;
			}
		};

		generateKey();
		// Depend on account?.address (the stable identity), NOT the account object: useActiveAccount
		// can hand back a new object reference on unrelated re-renders, and depending on the object
		// would re-run this effect every render — auto-retrying a just-rejected signature (so the
		// 'rejected' state never persists for the user's Retry). The address still changes on a real
		// wallet switch, so switch-detection is preserved.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [account?.address, sessionKey, ownerAddress, isTabVisible, dispatch, retryCount]);

	const value = useMemo(
		() => ({ sessionKey, status, activeWallet, ownerAddress, retry }),
		[sessionKey, status, activeWallet, ownerAddress, retry],
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
