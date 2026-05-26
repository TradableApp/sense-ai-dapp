import { test } from '@playwright/test';

test.describe('Graph — subgraph data layer (T-GRAPH)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires local Graph node + Hardhat node (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-GRAPH-01: Conversations query returns data after prompt', async () => {
		test.fixme(true, 'Pending: needs full local stack with indexed subgraph');
	});

	test('T-GRAPH-02: Message data matches on-chain event params', async () => {
		test.fixme(true, 'Pending: needs prompt submission + subgraph indexing');
	});
});
