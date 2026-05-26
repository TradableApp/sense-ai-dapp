import { test } from '../fixtures';

test.describe('Branching — conversation branch/split (T-BRANCH)', () => {
	test.skip(
		process.env.E2E_LOCAL_SERVICES !== '1',
		'Skipped: requires Hardhat node + oracle for multi-turn conversations (set E2E_LOCAL_SERVICES=1)',
	);

	test('T-BRANCH-01: Branch button appears on AI response messages', async ({ chatPage }) => {
		test.fixme(true, 'Pending: needs oracle response to show branch UI');
	});

	test('T-BRANCH-02: Branching creates a new conversation thread', async ({ chatPage }) => {
		test.fixme(true, 'Pending: needs full prompt → response → branch flow');
	});
});
