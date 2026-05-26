import { test } from '../fixtures';

test.describe('Refunds — stuck payments and cancellation (T-REFUND)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node + escrow contract + oracle (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-REFUND-01: Stuck request older than 1hr shows refund button', async ({
		authenticatedPage,
	}) => {
		// Requires: submit prompt → advance EVM time by 1hr → check refund UI
		test.fixme(true, 'Pending: needs EVM time manipulation helper in test');
	});

	test('T-REFUND-02: Claiming a refund returns tokens to user', async ({ authenticatedPage }) => {
		test.fixme(true, 'Pending: needs full oracle + time manipulation flow');
	});
});
