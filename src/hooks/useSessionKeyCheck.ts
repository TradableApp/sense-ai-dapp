import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/SessionProvider';
import { checkSessionKey, type SessionKeyCheck } from '@/lib/sessionKeyCheck';
import { reportSessionKeyMismatch } from '@/lib/sessionKeyReport';

/**
 * The key check for this session (`checkSessionKey`), once per key and account. A mismatch is
 * reported once per page load. A check that fails gives undefined and stops nothing: the
 * check only informs, it never holds the app.
 */
export default function useSessionKeyCheck(): SessionKeyCheck | undefined {
	const { sessionKey, ownerAddress } = useSession();
	const { data } = useQuery({
		queryKey: ['sessionKeyCheck', sessionKey, ownerAddress],
		queryFn: async () => {
			try {
				const outcome = await checkSessionKey(sessionKey as CryptoKey, ownerAddress as string);
				if (outcome === 'mismatch') reportSessionKeyMismatch();
				return outcome;
			} catch (error) {
				// The name only: the check holds nothing worth printing, and stops nothing.
				console.error(
					'[sessionKeyCheck] The key check could not be made:',
					error instanceof Error ? error.name : typeof error,
				);
				throw error;
			}
		},
		enabled: !!sessionKey && !!ownerAddress,
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
	});
	return data;
}
