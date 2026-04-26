import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import type { FaucetResponse } from './types';
import { functions } from '@/config/firebase';

const requestTestTokens = async (walletAddress: string): Promise<FaucetResponse> => {
	try {
		const faucetFunction = httpsCallable(functions, 'requestTestTokens');

		const result = await faucetFunction({ walletAddress });

		if ((result.data as any).success) {
			// We handle the "Success" toast in the component now,
			// so we can add the Explorer Link and Loading state there.
			return { success: true, txHash: (result.data as any).txHash };
		}

		throw new Error((result.data as any).message || 'Faucet failed');
	} catch (error) {
		console.error('[faucetService] Error:', error);
		// Handle specific rate limit messages nicely
		if ((error as Error).message.includes('rate limit')) {
			toast.error('Rate Limit Exceeded', {
				description: 'You can only request tokens once every 24 hours.',
			});
		} else {
			toast.error('Faucet Failed', {
				description: 'Could not dispense tokens. Please try again later.',
			});
		}

		return { success: false };
	}
};

export default requestTestTokens;
