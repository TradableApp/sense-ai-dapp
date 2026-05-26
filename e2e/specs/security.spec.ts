import { test } from '../fixtures';

test.describe('Security — encryption and key management (T-SEC)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node for wallet signing and transaction inspection (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-SEC-01: No plaintext prompts in IndexedDB', async ({ authenticatedPage }) => {
		test.fixme(true, 'Pending: needs authenticated session with submitted prompt');
	});

	test('T-SEC-02: Session key is not persisted to localStorage or sessionStorage', async ({
		authenticatedPage,
	}) => {
		test.fixme(true, 'Pending: needs authenticated session to inspect storage');
	});

	test('T-SEC-03: ECIES encrypted payload in contract calldata is not plaintext', async ({
		authenticatedPage,
	}) => {
		test.fixme(true, 'Pending: needs transaction submission to inspect calldata');
	});
});
