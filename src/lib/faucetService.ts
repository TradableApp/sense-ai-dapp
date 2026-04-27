import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { functions } from '@/config/firebase';

import type { FaucetResponse } from './types';

interface FaucetCallableResult {
	success: boolean;
	txHash?: string;
	message?: string;
}

const requestTestTokens = async (walletAddress: string): Promise<FaucetResponse> => {
	try {
		if (!functions) throw new Error('Firebase functions not initialized');
		const faucetFunction = httpsCallable(functions, 'requestTestTokens');

		const result = await faucetFunction({ walletAddress });
		const data = result.data as FaucetCallableResult;

		if (data.success) {
			// We handle the "Success" toast in the component now,
			// so we can add the Explorer Link and Loading state there.
			return { success: true, txHash: data.txHash };
		}

		throw new Error(data.message || 'Faucet failed');
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
