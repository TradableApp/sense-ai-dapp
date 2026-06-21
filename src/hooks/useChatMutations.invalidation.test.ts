import { describe, expect, it, vi } from 'vitest';

// useChatMutations pulls in thirdweb + crypto + faucet at module load; mock them so the exported
// pure helper can be imported and tested in isolation (mirrors useChatMutations.encrypt.test.ts).
vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({}));
vi.mock('thirdweb/react', () => ({}));
vi.mock('thirdweb/wallets', () => ({}));
vi.mock('@/lib/ecies', () => ({ default: vi.fn() }));
vi.mock('@/lib/crypto', () => ({
	encryptData: vi.fn(),
	decryptData: vi.fn(),
	deriveKeyFromEntropy: vi.fn(),
}));
vi.mock('@/lib/faucetService', () => ({ default: vi.fn() }));

import { postTxInvalidationKeys } from './useChatMutations';

// The query keys invalidated after a token-costing transaction confirms (the genericOnSuccess path,
// hit by every chat mutation). The regression this guards: the wallet-balance entry must be the real
// `['walletBalance', …]` key (via getTokenBalanceQueryKey), NOT the dead `['tokenBalance']` literal —
// otherwise the wallet balance never refreshes after a prompt/branch/etc. (CU-86d3dvy2y).
describe('postTxInvalidationKeys', () => {
	it('invalidates the real walletBalance key, never the dead [tokenBalance] literal', () => {
		const keys = postTxInvalidationKeys(31337, '0xUser', '0xToken');
		expect(keys).toContainEqual(['walletBalance', 31337, '0xUser', { tokenAddress: '0xToken' }]);
		expect(keys).not.toContainEqual(['tokenBalance']);
	});

	it('always includes the usagePlan key', () => {
		expect(postTxInvalidationKeys(31337, '0xUser', '0xToken')).toContainEqual(['usagePlan']);
	});

	it('wraps each extra key as its own single-element query key', () => {
		const keys = postTxInvalidationKeys(31337, '0xUser', '0xToken', ['stuckRequests', 'messages']);
		expect(keys).toContainEqual(['stuckRequests']);
		expect(keys).toContainEqual(['messages']);
	});
});
