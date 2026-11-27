import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The history key is made from a signature that must be the same every time the wallet signs
 * the session message. A plain account's signature is; a smart account's is not (a passkey
 * signs differently each time), so the wallets offered must not create smart accounts.
 */
type Wallets = (typeof import('@/config/thirdweb'))['wallets'];

let wallets: Wallets;

beforeAll(async () => {
	// The module refuses to load without a client id; any value does here, nothing is sent.
	vi.stubEnv('VITE_THIRDWEB_CLIENT_ID', 'test-client-id');
	({ wallets } = await import('@/config/thirdweb'));
});

describe('the wallets offered', () => {
	it('offers Coinbase Wallet in its plain-account mode only', () => {
		const coinbase = wallets.find(wallet => wallet.id === 'com.coinbase.wallet');

		expect(coinbase).toBeDefined();
		expect(coinbase?.getConfig()).toMatchObject({ walletConfig: { options: 'eoaOnly' } });
	});

	it('offers no wallet that is a smart account', () => {
		const ids = wallets.map(wallet => wallet.id);

		expect(ids).not.toContain('smart');
		expect(ids).not.toContain('org.base.account');
	});
});
