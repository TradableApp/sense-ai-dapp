import { describe, expect, it, vi } from 'vitest';

// useTokenBalance pulls in thirdweb hooks + the thirdweb client at module load; mock them so the
// pure key-generator can be imported and tested in isolation (it never calls the hooks).
vi.mock('thirdweb/react', () => ({ useActiveWallet: vi.fn(), useWalletBalance: vi.fn() }));
vi.mock('@/config/thirdweb', () => ({ client: {} }));

import { getTokenBalanceQueryKey } from './useTokenBalance';

// Guards the EXACT query key thirdweb's `useWalletBalance` registers — the single source of truth
// every wallet-balance invalidation must use. Historically several call sites invalidated the dead
// literal `['tokenBalance']` (CU-86d3dvy2y), which matches nothing, so live/post-tx balance refreshes
// were silent no-ops. This locks the contract so a future thirdweb key change is caught here.
describe('getTokenBalanceQueryKey', () => {
	it('returns the exact key thirdweb useWalletBalance uses (walletBalance, …)', () => {
		expect(getTokenBalanceQueryKey(31337, '0xUser', '0xToken')).toEqual([
			'walletBalance',
			31337,
			'0xUser',
			{ tokenAddress: '0xToken' },
		]);
	});

	it('is NOT the dead `[tokenBalance]` literal that used to be invalidated', () => {
		expect(getTokenBalanceQueryKey(31337, '0xUser', '0xToken')).not.toEqual(['tokenBalance']);
	});

	it('uses safe sentinels when args are undefined (no crash, still walletBalance-shaped)', () => {
		expect(getTokenBalanceQueryKey(undefined, undefined, undefined)).toEqual([
			'walletBalance',
			-1,
			'0x0',
			{ tokenAddress: undefined },
		]);
	});
});
