import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { functions } from '@/config/firebase';

const requestTestTokens = async walletAddress => {
	try {
		const faucetFunction = httpsCallable(functions, 'requestTestTokens');

		const result = await faucetFunction({ walletAddress });

		if (result.data.success) {
			// We handle the "Success" toast in the component now,
			// so we can add the Explorer Link and Loading state there.
			return { success: true, txHash: result.data.txHash };
		}

		throw new Error(result.data.message || 'Faucet failed');
	} catch (error) {
		console.error('[faucetService] Error:', error);
		// Handle specific rate limit messages nicely
		if (error.message.includes('rate limit')) {
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
