import { expect, test } from '../fixtures';
import { getFeeConfig, getProtocolConfig, waitForGraph } from '../helpers/graph';
import {
	activatePlan,
	fundABLE,
	setBranchFee,
	setCancellationFee,
	setMetadataUpdateFee,
	setPromptFee,
	setTreasury,
} from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const ABLE = 10n ** 18n;
const SKIP_REASON =
	'Skipped: requires Hardhat node + escrow + Graph node (set E2E_LOCAL_SERVICES=1)';

// A well-known Hardhat account (#9) used as the rotated-treasury target — deterministic and distinct
// from the deployer (#0, the owner) and the test users (#2..#19).
const NEW_TREASURY = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';

// Area 9a — governance config indexing + continuity. Contract-level governance (owner-only setters,
// UUPS) is unit-tested in tokenized-ai-agent and the subgraph handlers are matchstick-tested; these
// assert the CROSS-LAYER path on a real stack: an on-chain governance change is reflected in the
// subgraph's FeeConfig/ProtocolConfig singletons, and the dApp keeps working through it. Owner-only
// setters are sent by the deployer (account 0). Oracle rotation (entangled with answering) is
// deferred to Area 9d; here we only make changes that don't break the prompt→answer path.

test.describe('Governance config indexing (T-GOV-CFG)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test('T-GOV-CFG-01: the four fee changes are indexed into the FeeConfig singleton', async () => {
		// Distinct sentinel values so the assertion can't pass by coincidence with the deploy defaults.
		const promptFee = 3n * ABLE;
		const branchFee = 4n * ABLE;
		const cancellationFee = 5n * ABLE;
		const metadataUpdateFee = 6n * ABLE;

		await setPromptFee(ESCROW_ADDRESS, promptFee);
		await setBranchFee(ESCROW_ADDRESS, branchFee);
		await setCancellationFee(ESCROW_ADDRESS, cancellationFee);
		await setMetadataUpdateFee(ESCROW_ADDRESS, metadataUpdateFee);

		await waitForGraph(
			() => getFeeConfig(),
			c =>
				c?.promptFee === String(promptFee) &&
				c?.branchFee === String(branchFee) &&
				c?.cancellationFee === String(cancellationFee) &&
				c?.metadataUpdateFee === String(metadataUpdateFee),
			{ label: 'FeeConfig reflects all four fees' },
		);
	});

	test('T-GOV-CFG-02: a treasury change is indexed into the ProtocolConfig singleton', async () => {
		await setTreasury(ESCROW_ADDRESS, NEW_TREASURY);

		await waitForGraph(
			() => getProtocolConfig(),
			c => c?.treasuryAddress?.toLowerCase() === NEW_TREASURY.toLowerCase(),
			{ label: 'ProtocolConfig reflects the new treasury' },
		);
	});
});

// Continuity: a governance change can land mid-session and the dApp still completes a full
// prompt → answer round-trip — the "zero-downtime governance" claim, verified end-to-end.
test.describe('Governance continuity (T-GOV-CFG)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});

	test('T-GOV-CFG-03: the dApp still answers a prompt after a governance change', async ({
		freshChatPage,
	}) => {
		// A self-contained governance change (owner lowers the prompt fee), then the funded user still
		// completes a full round-trip — proving the change didn't break the answer path.
		await setPromptFee(ESCROW_ADDRESS, 2n * ABLE);

		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Still working after the governance change?');
		await expect(freshChatPage.assistantMessages.last()).toBeVisible();
	});
});
