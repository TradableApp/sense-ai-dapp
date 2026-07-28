import { expect, test } from '../fixtures';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { getFeeConfig, getPromptRequests, getProtocolConfig, waitForGraph } from '../helpers/graph';
import {
	getABLEBalance,
	getOracle,
	getOwner,
	getPromptFee,
	getSpendingLimit,
	getTreasury,
	setBranchFee,
	setCancellationFee,
	setMetadataUpdateFee,
	setOracle,
	setPromptFee,
	setPromptFeeFrom,
	setTreasury,
	transferOwnership,
	upgradeEscrowToV2,
	usePromptFeeRestore,
} from '../helpers/hardhat';

const AGENT_ADDRESS = process.env.VITE_AGENT_CONTRACT_ADDRESS ?? '';
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

// A synthetic, non-Hardhat address used as the rotated-oracle target. The oracle address is never a
// fund recipient and we never send txs from it, so a synthetic address is fine; it's restored to the
// original in afterEach. Lowercase for the same reason as NEW_TREASURY.
const NEW_ORACLE = '0x000000000000000000000000000000000000face';

const isPending = (r: {
	isAnswered: boolean;
	isCancelled: boolean;
	isRefunded: boolean;
}): boolean => !r.isAnswered && !r.isCancelled && !r.isRefunded;

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
	let originalTreasury: string | undefined;
	test.beforeEach(async () => {
		originalTreasury = await getTreasury(ESCROW_ADDRESS);
	});
	test.afterEach(async () => {
		// Guard: if beforeEach threw before snapshotting, don't restore with undefined (which would
		// throw a cryptic viem error in afterEach and mask the real beforeEach failure).
		if (originalTreasury !== undefined) await setTreasury(ESCROW_ADDRESS, originalTreasury);
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

	// Shared fixture rather than a local capture/restore pair — see usePromptFeeRestore in
	// helpers/hardhat.ts. Registered before the beforeEach below so the capture runs first.
	usePromptFeeRestore(test, ESCROW_ADDRESS);

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
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

	let originalOwner: string | undefined;
	let originalPromptFee: bigint | undefined;
	test.beforeEach(async () => {
		originalOwner = await getOwner(ESCROW_ADDRESS);
		originalPromptFee = await getPromptFee(ESCROW_ADDRESS);
	});
	test.afterEach(async () => {
		// Hand ownership back (from whoever holds it now) and restore the fee, so owner-only ops keep
		// working for the rest of the suite. Decouple the two with try/finally so a failed ownership
		// restore doesn't skip the fee restore (which would leave the next beforeEach snapshotting a
		// dirty owner+fee). If ownership is somehow still NEW_OWNER, the fee restore reverts — which
		// surfaces the real problem rather than hiding it behind a silently-skipped restore. Each
		// restore is also guarded against an undefined snapshot (a beforeEach that threw early).
		try {
			if (originalOwner !== undefined) {
				const currentOwner = await getOwner(ESCROW_ADDRESS);
				if (currentOwner.toLowerCase() !== originalOwner.toLowerCase()) {
					await transferOwnership(ESCROW_ADDRESS, originalOwner, currentOwner);
				}
			}
		} finally {
			if (originalOwner !== undefined && originalPromptFee !== undefined) {
				await setPromptFeeFrom(ESCROW_ADDRESS, originalOwner, originalPromptFee);
			}
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
			},
		);
	});

	test('T-GOV-OWN-02: a user can still complete a prompt after an ownership transfer', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await fundAndActivatePlan(freshUserAccount.address);

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
		await fundAndActivatePlan(freshUserAccount.address);
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

// Area 9d — oracle rotation (of the EVMAIAgent, which owns the oracle address). The contract-level
// setOracle is unit-tested in tokenized-ai-agent; here we assert the cross-layer effect: a rotation
// indexes into ProtocolConfig, and in-flight prompts are not orphaned by it.
//
// The dApp's STALENESS failure mode (it holds VITE_ORACLE_PUBLIC_KEY from env, never read from chain,
// so a rotation to a genuinely different key would leave prompts encrypted to the old key and never
// answered) cannot be injected in this harness: the key is build-time-baked and the localnet runs a
// single oracle process. Its user-facing OUTCOME — a prompt submitted but never answered, then
// recoverable via refund — is already covered by T-REFUND-01 / T-STUCK-01 (the __E2E_DROP__ sentinel
// produces the same observable state). The root-cause design risk (read the oracle key from chain so
// a rotation reaches the dApp) is tracked as a backlog ticket; see the PR description.
test.describe('Governance oracle rotation (T-GOV-ORACLE)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(
		!TOKEN_ADDRESS || !ESCROW_ADDRESS || !AGENT_ADDRESS,
		'Skipped: contract addresses not set',
	);

	// The on-chain oracle is owner-global; snapshot + restore it so the rotation doesn't leak into the
	// rest of the run. (The running oracle keeps DECRYPTING with its signer key, but answer submission
	// is onlyOracle-gated — so once rotated it can no longer SUBMIT; see T-GOV-ORACLE-02.)
	let originalOracle: string | undefined;
	test.beforeEach(async () => {
		originalOracle = await getOracle(AGENT_ADDRESS);
	});
	test.afterEach(async () => {
		// Guard: skip the restore if beforeEach threw before snapshotting (see treasury note above).
		if (originalOracle !== undefined) await setOracle(AGENT_ADDRESS, originalOracle);
	});

	test('T-GOV-ORACLE-01: an oracle rotation is indexed into the ProtocolConfig singleton', async () => {
		await setOracle(AGENT_ADDRESS, NEW_ORACLE);

		// Runs after the earlier describes' answer round-trips, so graph-node lags past the 30s default
		// — give the indexing wait headroom (see ADR-0002 / the e2e troubleshooting note).
		await waitForGraph(
			() => getProtocolConfig(),
			c => c?.oracleAddress?.toLowerCase() === NEW_ORACLE.toLowerCase(),
			{ label: 'ProtocolConfig reflects the rotated oracle' },
		);
	});

	test('T-GOV-ORACLE-02: a mid-flight oracle rotation orphans the in-flight prompt (onlyOracle answer-submit)', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		// FINDING (see ADR-0006 + the linked tokenized-ai-agent issue / CU task): answer submission is
		// onlyOracle-gated to a SINGLE address, so the instant the oracle is rotated the running oracle
		// can no longer submit — any in-flight prompt is ORPHANED (submitAnswer reverts with
		// UnauthorizedOracle and the oracle then hits a FATAL non-retryable error). A naive rotation is
		// therefore NOT zero-downtime. This locks in the known risk until the planned multi-oracle
		// (ORACLE_ROLE) + shared-key design (Option B) lands; the orphaned prompt is recoverable via
		// refund exactly like a stuck prompt (T-REFUND-01 / T-STUCK-01).
		await fundAndActivatePlan(freshUserAccount.address);

		await freshChatPage.goto();
		// The oracle holds the answer for 20s (mock sentinel), giving a deterministic window to rotate
		// the oracle BEFORE it attempts to submit — so the orphan is caused by the rotation, not a race.
		await freshChatPage.sendPrompt(
			'Orphaned by a mid-flight oracle rotation __E2E_DELAY_MS__:20000',
		);
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await setOracle(AGENT_ADDRESS, NEW_ORACLE);

		// Wait past the answer-delay window so the oracle's now-delayed submitAnswer has fired and
		// reverted (onlyOracle) — this makes the pending state DURABLE (orphaned), not merely "not yet
		// answered". A bounded wait is required to prove non-delivery of the held answer.
		await freshPage.waitForTimeout(25_000);

		// Orphaned: the prompt stays PENDING on-chain — never answered. waitForGraph (not a single read)
		// because this runs last in the serial suite, so graph-node lags past the 30s default; once
		// indexed it is pending and STAYS pending (the old oracle can no longer submit), so the wait
		// resolves — whereas if the rotation had lost the race the prompt would be answered and this
		// would (correctly) time out.
		await waitForGraph(
			() => getPromptRequests(freshUserAccount.address),
			reqs => reqs.some(isPending),
			{ label: 'orphaned prompt stays pending (unanswered)' },
		);
		await expect(freshChatPage.assistantMessages).toHaveCount(0);
	});
});

// Area 9e — UUPS upgrade continuity (of the escrow proxy, which holds spending limits + escrows). The
// contract-level upgrade (onlyOwner, storage preserved, version 2.0) is unit-tested in
// tokenized-ai-agent; here we prove the CROSS-LAYER claim on a real stack: a live upgrade preserves
// user state and the dApp keeps working on the same proxy address. The upgrade is run via the agent
// repo's hardhat-upgrades script (see upgradeEscrowToV2). It is left in place — EVMAIAgentEscrowV2
// inherits all V1 logic (behaviourally identical + a version() marker), and the stack is fresh per run.
test.describe('Governance UUPS upgrade (T-GOV-UPGRADE)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test('T-GOV-UPGRADE-01: a UUPS upgrade preserves state and the dApp keeps working', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await fundAndActivatePlan(freshUserAccount.address);

		// Pre-upgrade state: the user's spending limit is set in the escrow's storage.
		const before = await getSpendingLimit(ESCROW_ADDRESS, freshUserAccount.address);
		expect(before.allowance).toBeGreaterThan(0n);
		expect(before.expiresAt).toBeGreaterThan(0n);

		await freshChatPage.goto();

		// Upgrade the escrow proxy implementation to V2 against the live stack.
		await upgradeEscrowToV2(ESCROW_ADDRESS);

		// Storage preserved: the spending limit survived the implementation swap (same proxy, same
		// storage slots) — allowance + expiry are unchanged.
		const after = await getSpendingLimit(ESCROW_ADDRESS, freshUserAccount.address);
		expect(after.allowance).toBe(before.allowance);
		expect(after.spentAmount).toBe(before.spentAmount);
		expect(after.expiresAt).toBe(before.expiresAt);

		// Continuity: the dApp still completes a full prompt → answer on the same proxy address.
		await freshChatPage.sendPromptAndWaitForResponse('Still working after a UUPS upgrade?');
		await expect(freshChatPage.assistantMessages.last()).toBeVisible();
	});
});
