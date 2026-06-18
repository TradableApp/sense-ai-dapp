import { expect, test } from '../fixtures';
import { getFeeConfig, getProtocolConfig, waitForGraph } from '../helpers/graph';
import {
	activatePlan,
	fundABLE,
	getABLEBalance,
	getOwner,
	getPromptFee,
	getTreasury,
	setBranchFee,
	setCancellationFee,
	setMetadataUpdateFee,
	setPromptFee,
	setPromptFeeFrom,
	setTreasury,
	transferOwnership,
} from '../helpers/hardhat';

const TOKEN_ADDRESS = process.env.VITE_TOKEN_CONTRACT_ADDRESS ?? '';
const ESCROW_ADDRESS = process.env.VITE_ESCROW_CONTRACT_ADDRESS ?? '';
const PLAN_ALLOWANCE = 10n ** 18n * 100n; // 100 ABLE
const ABLE = 10n ** 18n;
const SKIP_REASON =
	'Skipped: requires Hardhat node + escrow + Graph node (set E2E_LOCAL_SERVICES=1)';

// A synthetic, non-Hardhat address used as the rotated-treasury target. Using an address that is
// never allocated to a test user means settlement fees routed into it (T-GOV-TREAS-01) can't pollute
// a fresh user's balance. Lowercase — the subgraph stores Bytes lowercase and viem encodes it fine
// (the 9a treasury restore already round-trips lowercase addresses through setTreasury).
const NEW_TREASURY = '0x000000000000000000000000000000000000beef';

// The reserved Hardhat account #1 (NOT in the fresh-user pool) used as the new owner. It must be a
// real unlocked account so it can send owner-only txs; ownership is restored to the original in
// afterEach so the change never bricks owner-only ops for the rest of the suite.
const NEW_OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Area 9a — governance config indexing + continuity. Contract-level governance (owner-only setters,
// UUPS) is unit-tested in tokenized-ai-agent and the subgraph handlers are matchstick-tested; these
// assert the CROSS-LAYER path on a real stack: an on-chain governance change is reflected in the
// subgraph's FeeConfig/ProtocolConfig singletons, and the dApp keeps working through it. Owner-only
// setters are sent by the deployer (account 0). Oracle rotation (entangled with answering) is
// deferred to Area 9d; here we only make changes that don't break the prompt→answer path.

test.describe('Governance config indexing (T-GOV-CFG)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	// The treasury is owner-global state shared by the whole suite, and (unlike fees, which downstream
	// tests read dynamically — see contract-cost.spec) a changed treasury would surprise later tests
	// that assume the deploy default. So snapshot it and restore after each test to avoid leaking the
	// change into the rest of the run. (Fee sentinels are intentionally NOT restored: no downstream
	// test asserts an exact fee, and contract-cost reads/restores its own fee dynamically.)
	let originalTreasury: string;
	test.beforeEach(async () => {
		originalTreasury = await getTreasury(ESCROW_ADDRESS);
	});
	test.afterEach(async () => {
		await setTreasury(ESCROW_ADDRESS, originalTreasury);
	});

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

// Continuity: a governance change lands WHILE a session is live, and the dApp still completes a full
// prompt → answer round-trip — the "zero-downtime governance" claim, verified end-to-end.
test.describe('Governance continuity (T-GOV-CFG)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let originalPromptFee: bigint;
	test.beforeEach(async ({ freshUserAccount }) => {
		originalPromptFee = await getPromptFee(ESCROW_ADDRESS);
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});
	test.afterEach(async () => {
		await setPromptFee(ESCROW_ADDRESS, originalPromptFee);
	});

	test('T-GOV-CFG-03: the dApp still answers a prompt after a mid-session governance change', async ({
		freshChatPage,
	}) => {
		// Establish a live session on the chat page FIRST, then change the fee while the dApp is live,
		// then send a prompt — proving a governance change mid-session doesn't break the answer path
		// (not merely that the dApp cold-starts correctly after a change).
		await freshChatPage.goto();
		await setPromptFee(ESCROW_ADDRESS, 2n * ABLE);
		await freshChatPage.sendPromptAndWaitForResponse(
			'Still working after a mid-session fee change?',
		);
		await expect(freshChatPage.assistantMessages.last()).toBeVisible();
	});
});

// Area 9b — ownership transfer (of the escrow, where the fee setters live). OwnableUpgradeable is
// single-step; the contract-level transfer is unit-tested in tokenized-ai-agent, so here we assert
// the cross-layer effect: access control flips (old owner's setter reverts, new owner's succeeds and
// still indexes) and users are unaffected. Ownership is snapshotted + restored so a failed restore
// can't brick owner-only ops for the rest of the run.
test.describe('Governance ownership transfer (T-GOV-OWN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let originalOwner: string;
	let originalPromptFee: bigint;
	test.beforeEach(async () => {
		originalOwner = await getOwner(ESCROW_ADDRESS);
		originalPromptFee = await getPromptFee(ESCROW_ADDRESS);
	});
	test.afterEach(async () => {
		// Hand ownership back (from whoever holds it now) and restore the fee, so owner-only ops keep
		// working for the rest of the suite. Decouple the two with try/finally so a failed ownership
		// restore doesn't skip the fee restore (which would leave the next beforeEach snapshotting a
		// dirty owner+fee). If ownership is somehow still NEW_OWNER, the fee restore reverts — which
		// surfaces the real problem rather than hiding it behind a silently-skipped restore.
		const currentOwner = await getOwner(ESCROW_ADDRESS);
		try {
			if (currentOwner.toLowerCase() !== originalOwner.toLowerCase()) {
				await transferOwnership(ESCROW_ADDRESS, originalOwner, currentOwner);
			}
		} finally {
			await setPromptFeeFrom(ESCROW_ADDRESS, originalOwner, originalPromptFee);
		}
	});

	test('T-GOV-OWN-01: after an ownership transfer, only the new owner can set fees', async () => {
		await transferOwnership(ESCROW_ADDRESS, NEW_OWNER); // from the current owner (deployer) → NEW_OWNER

		// The old owner (deployer) can no longer set fees — the onlyOwner guard reverts the tx.
		await expect(setPromptFee(ESCROW_ADDRESS, 7n * ABLE)).rejects.toThrow();

		// The new owner can, and the change still indexes into FeeConfig (cross-layer). Runs after the
		// continuity describe's answer round-trip, so graph-node can lag well past the 30s default —
		// give the indexing wait headroom (same reason as T-REFUND-03).
		await setPromptFeeFrom(ESCROW_ADDRESS, NEW_OWNER, 7n * ABLE);
		await waitForGraph(
			() => getFeeConfig(),
			c => c?.promptFee === String(7n * ABLE),
			{
				label: 'new owner fee change indexed',
				timeoutMs: 60_000,
			},
		);
	});

	test('T-GOV-OWN-02: a user can still complete a prompt after an ownership transfer', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);

		await freshChatPage.goto();
		await transferOwnership(ESCROW_ADDRESS, NEW_OWNER); // ownership changes while the session is live
		await freshChatPage.sendPromptAndWaitForResponse(
			'Still answering after an ownership transfer?',
		);
		await expect(freshChatPage.assistantMessages.last()).toBeVisible();
	});
});

// Area 9c — treasury routing. After a treasury change, settled prompt fees pay out to the NEW
// treasury (refunds, by contrast, return to the user — covered by the T-REFUND suite). Treasury is
// snapshotted + restored so the routing change doesn't leak into the rest of the run.
test.describe('Governance treasury routing (T-GOV-TREAS)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	let originalTreasury: string;
	test.beforeEach(async ({ freshUserAccount }) => {
		originalTreasury = await getTreasury(ESCROW_ADDRESS);
		await fundABLE(TOKEN_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
		await activatePlan(TOKEN_ADDRESS, ESCROW_ADDRESS, freshUserAccount.address, PLAN_ALLOWANCE);
	});
	test.afterEach(async () => {
		await setTreasury(ESCROW_ADDRESS, originalTreasury);
	});

	test('T-GOV-TREAS-01: a settled prompt routes its fee to the current treasury', async ({
		freshChatPage,
	}) => {
		await setTreasury(ESCROW_ADDRESS, NEW_TREASURY);
		const fee = await getPromptFee(ESCROW_ADDRESS);
		// Guard against a vacuous pass: if a prior test left the fee at 0, the balance-delta assertion
		// below (`after - before == fee`) would trivially hold while nothing was actually routed.
		expect(fee).toBeGreaterThan(0n);
		const treasuryBefore = await getABLEBalance(TOKEN_ADDRESS, NEW_TREASURY);

		// A full prompt → answer round-trip finalizes the escrow, which pays the fee out to the treasury.
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Route my fee to the new treasury.');

		const treasuryAfter = await getABLEBalance(TOKEN_ADDRESS, NEW_TREASURY);
		expect(treasuryAfter - treasuryBefore).toBe(fee);
	});
});
