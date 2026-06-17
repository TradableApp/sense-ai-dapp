/**
 * Whether the session key must be (re)derived for the currently-connected wallet account.
 *
 * Returns true when there is no key yet, OR the existing key was derived for a DIFFERENT account
 * (the user switched accounts in their wallet). Handling the latter is what keeps a wallet switch
 * from leaving the previous account's session key — and its decrypted conversation data — active
 * under the new account (the isolation gap T-MULTI-07 surfaced).
 *
 * @param hasSessionKey Whether a session key currently exists.
 * @param derivedForAddress The address the current key was derived for (the session owner).
 * @param connectedAddress The address of the currently-connected wallet account.
 */
export default function needsSessionDerivation(
	hasSessionKey: boolean,
	derivedForAddress: string | null,
	connectedAddress: string | null | undefined,
): boolean {
	if (!connectedAddress) return false; // nothing connected → nothing to derive
	if (!hasSessionKey) return true; // first derivation for this account
	return derivedForAddress !== connectedAddress; // account switched → re-derive
}
