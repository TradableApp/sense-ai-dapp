import { expect, test } from '../fixtures';
import { LIVE_STACK } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import {
	getFeeConfig,
	getOracleChanges,
	getOracles,
	getPromptRequests,
	getProtocolConfig,
	waitForGraph,
} from '../helpers/graph';
import {
	addOracle,
	DEPLOYER_ADDRESS,
	getABLEBalance,
	getOwner,
	getPromptFee,
	getSpendingLimit,
	getTreasury,
	isOracle,
	removeOracle,
	setBranchFee,
	setCancellationFee,
	setMetadataUpdateFee,
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

// A synthetic, non-Hardhat address used as the second oracle in a rotation. It is never a fund
// recipient and no transaction is sent from it, so a synthetic address is fine; it is removed again
// in afterEach. Lowercase for the same reason as NEW_TREASURY.
const NEW_ORACLE = '0x000000000000000000000000000000000000face';

// The deployer (Hardhat account 0) owns the agent and sends addOracle / removeOracle. Lowercase:
// the subgraph stores Bytes lowercase.
const OWNER = DEPLOYER_ADDRESS.toLowerCase();

const isPending = (r: {
	isAnswered: boolean;
	isCancelled: boolean;
	isRefunded: boolean;
}): boolean => !r.isAnswered && !r.isCancelled && !r.isRefunded;

// Area 9a — governance config indexing + continuity. Contract-level governance (owner-only setters,
// UUPS) is unit-tested in tokenized-ai-agent and the subgraph handlers are matchstick-tested; these
// assert the CROSS-LAYER path on a real stack: an on-chain governance change is reflected in the
// subgraph's FeeConfig/ProtocolConfig singletons, and the dApp keeps working through it. Owner-only
// setters are sent by the deployer (account 0). The oracle set (entangled with answering) is
// in Area 9d; here we only make changes that don't break the prompt→answer path.

test.describe('Governance config indexing (T-GOV-CFG)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
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
	test.skip(!LIVE_STACK, SKIP_REASON);
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
	test.skip(!LIVE_STACK, SKIP_REASON);
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
	test.skip(!LIVE_STACK, SKIP_REASON);
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

// Area 9d — the oracle set (on the EVMAIAgent, which authorizes oracles through a role several
// addresses can hold at once). The contract rules are unit-tested in tokenized-ai-agent and the
// handlers are matchstick-tested in sense-ai-subgraph; here we assert the cross-layer effect on a
// real stack: the set and its history are indexed, a rotation with an overlap leaves no prompt
// unanswered, and an oracle that loses the role keeps a prompt in flight and answers it once the
// role is back.
//
// The localnet runs one oracle process, so the second oracle of a rotation is an address with no
// process behind it: what is proven is that adding and removing it never interrupts the running
// oracle. A cut-over to a second live oracle needs a second process and is not exercised here.
test.describe('Governance oracle set (T-GOV-ORACLE)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
	test.skip(
		!TOKEN_ADDRESS || !ESCROW_ADDRESS || !AGENT_ADDRESS,
		'Skipped: contract addresses not set',
	);

	// The role is owner-global, so each test starts from, and is restored to, exactly one active
	// oracle: the running one. Read from the index, not assumed, so a leak from an earlier test
	// fails here with a clear message instead of inside a later assertion.
	let runningOracle: string | undefined;
	test.beforeEach(async () => {
		const active = await waitForGraph(
			() => getOracles().then(all => all.filter(o => o.active)),
			set => set.length === 1,
			{ label: 'exactly one active oracle before the test' },
		);
		runningOracle = active[0].address;
		expect(await isOracle(AGENT_ADDRESS, runningOracle)).toBe(true);
	});
	test.afterEach(async () => {
		// Both calls change nothing when there is nothing to change. Skipped if beforeEach threw
		// before it knew the running oracle (see the treasury note above).
		await removeOracle(AGENT_ADDRESS, NEW_ORACLE);
		if (runningOracle !== undefined) await addOracle(AGENT_ADDRESS, runningOracle);
	});

	test('T-GOV-ORACLE-01: adding and removing a second oracle is indexed as a set with its history', async () => {
		const before = (await getOracleChanges(NEW_ORACLE)).length;

		await addOracle(AGENT_ADDRESS, NEW_ORACLE);
		// Two oracles hold the role at once: the overlap a rotation relies on.
		await waitForGraph(
			() => getOracles(),
			all =>
				all.filter(o => o.active).length === 2 &&
				all.some(o => o.address === NEW_ORACLE && o.active && o.removedAt === null),
			{ label: 'both oracles active' },
		);

		await removeOracle(AGENT_ADDRESS, NEW_ORACLE);
		// The removed oracle stays on record as inactive; the running one is untouched.
		const after = await waitForGraph(
			() => getOracles(),
			all => all.some(o => o.address === NEW_ORACLE && !o.active && o.removedAt !== null),
			{ label: 'second oracle recorded as removed' },
		);
		expect(after.filter(o => o.active).map(o => o.address)).toEqual([runningOracle]);

		// One immutable record per change, in order, naming the owner as the caller.
		const changes = await waitForGraph(
			() => getOracleChanges(NEW_ORACLE),
			rows => rows.length === before + 2,
			{ label: 'one history record per change' },
		);
		const [added, removed] = changes.slice(-2);
		expect([added.kind, removed.kind]).toEqual(['ADDED', 'REMOVED']);
		expect([added.caller, removed.caller]).toEqual([OWNER, OWNER]);
	});

	test('T-GOV-ORACLE-02: a prompt in flight through a rotation overlap is answered, and so is the next', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await fundAndActivatePlan(freshUserAccount.address);

		await freshChatPage.goto();
		// The oracle holds the answer for 20 s (mock sentinel): a fixed window in which the set
		// changes while this prompt is in flight.
		await freshChatPage.sendPrompt('In flight through a rotation overlap __E2E_DELAY_MS__:20000');
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await addOracle(AGENT_ADDRESS, NEW_ORACLE);

		// Adding an oracle takes nothing from the running one: the held answer still lands.
		await expect(freshChatPage.assistantMessages).toHaveCount(1, { timeout: 90_000 });

		// Removing the second oracle again does not interrupt service either.
		await removeOracle(AGENT_ADDRESS, NEW_ORACLE);
		await freshChatPage.sendPromptAndWaitForResponse('Still answered after the rotation.');
		await waitForGraph(
			() => getPromptRequests(freshUserAccount.address),
			reqs => reqs.length === 2 && reqs.every(r => r.isAnswered),
			{ label: 'both prompts answered' },
		);
	});

	test('T-GOV-ORACLE-03: an oracle that loses the role mid-flight keeps the prompt and answers once the role is back', async ({
		freshUserAccount,
		freshChatPage,
		freshPage,
	}) => {
		// Worst case after the role returns, from the oracle's own timings: its role recheck runs
		// every 30 s, the retry pass every 60 s, the queued prompt is due 30 s after it was refused,
		// and the retry holds the mock answer for 20 s again. 30 + 60 + 20 = 110 s, so 240 s leaves
		// room for indexing lag at the end of the serial suite.
		const ANSWER_AFTER_ROLE_RETURNS_MS = 240_000;
		// 30 s to see the prompt pending + 25 s wait + the budget above + the indexing waits.
		test.setTimeout(420_000);
		await fundAndActivatePlan(freshUserAccount.address);

		await freshChatPage.goto();
		// The 20 s hold gives a fixed window to remove the role BEFORE the oracle submits, so the
		// refusal is caused by the removal, not by a race.
		await freshChatPage.sendPrompt('Held while the oracle has no role __E2E_DELAY_MS__:20000');
		await expect(freshChatPage.cancelButton).toBeVisible({ timeout: 30_000 });
		await removeOracle(AGENT_ADDRESS, runningOracle!);

		// Past the hold: the submission has been attempted and refused. A bounded wait is the only
		// way to show the held answer was not delivered.
		await freshPage.waitForTimeout(25_000);
		await waitForGraph(
			() => getPromptRequests(freshUserAccount.address),
			reqs => reqs.some(isPending),
			{ label: 'prompt still pending while the oracle has no role' },
		);
		await expect(freshChatPage.assistantMessages).toHaveCount(0);

		// The owner gives the role back. The oracle did not exit: it waited, and now answers the
		// prompt it kept, with no resubmission and no refund.
		await addOracle(AGENT_ADDRESS, runningOracle!);
		await expect(freshChatPage.assistantMessages).toHaveCount(1, {
			timeout: ANSWER_AFTER_ROLE_RETURNS_MS,
		});
		await waitForGraph(
			() => getPromptRequests(freshUserAccount.address),
			reqs => reqs.length === 1 && reqs[0].isAnswered,
			{ label: 'the kept prompt is answered, once' },
		);
	});
});

// Area 9e — UUPS upgrade continuity (of the escrow proxy, which holds spending limits + escrows). The
// contract-level upgrade (onlyOwner, storage preserved, version 2.0) is unit-tested in
// tokenized-ai-agent; here we prove the CROSS-LAYER claim on a real stack: a live upgrade preserves
// user state and the dApp keeps working on the same proxy address. The upgrade is run via the agent
// repo's hardhat-upgrades script (see upgradeEscrowToV2). It is left in place — EVMAIAgentEscrowV2
// inherits all V1 logic (behaviourally identical + a version() marker), and the stack is fresh per run.
test.describe('Governance UUPS upgrade (T-GOV-UPGRADE)', () => {
	test.skip(!LIVE_STACK, SKIP_REASON);
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
