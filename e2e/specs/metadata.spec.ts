import { expect, test } from '../fixtures';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { getConversation, getConversations, waitForGraph } from '../helpers/graph';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node for the metadata round-trip (set E2E_LOCAL_SERVICES=1)';

// Rename / delete on-chain round-trip. A rename or delete is a MetadataUpdateRequested write →
// the oracle's handleMetadataUpdate writes a NEW ConversationMetadataFile and emits
// ConversationMetadataUpdated → the subgraph's `conversationMetadataCID` changes → on the next
// sync the dApp decrypts the new metadata (the new title, or the isDeleted flag — the subgraph's
// `isDeleted` stays false by design; the deletion lives in the encrypted metadata). T-HIST-08/09
// assert only the optimistic UI; these assert the change ROUND-TRIPS and SURVIVES a re-sync.
//
// The session key lives in React state (never persisted), so a full reload would drop it; we
// re-sync via in-app navigation (history → chat → history) instead, which re-mounts History and
// refetches from remote with the session intact. Fresh funded account per test; serial.
test.describe('Metadata round-trip (T-META)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-META-01: a rename round-trips and persists across a re-sync', async ({
		freshChatPage,
		freshHistoryPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Original title for rename');

		const convs = await waitForGraph(() => getConversations(owner), c => c.length === 1, {
			label: 'conversation indexed',
		});
		const convId = convs[0].id;
		const before = await getConversation(convId);
		expect(before).not.toBeNull(); // baseline must exist, else the CID-change check is vacuous
		const baselineCid = before!.conversationMetadataCID;

		await freshHistoryPage.goto();
		await freshHistoryPage.assertHasConversations();
		await freshHistoryPage.renameConversation(0, 'Renamed via roundtrip');

		// Cross-layer: the rename is processed by the oracle and re-indexed — the conversation's
		// metadata CID changes (a new ConversationMetadataFile).
		await waitForGraph(
			() => getConversation(convId),
			c => c != null && c.conversationMetadataCID !== baselineCid,
			{ label: 'ConversationMetadataUpdated indexed' },
		);

		// dApp: leave and re-enter History (re-mount → re-sync from remote). The new title persists
		// — it isn't just the optimistic local edit.
		await freshChatPage.goto();
		await freshHistoryPage.goto();
		await expect(freshHistoryPage.conversationItems.first()).toContainText('Renamed via roundtrip', {
			timeout: 15_000,
		});
	});

	test('T-META-02: a delete round-trips and stays deleted across a re-sync', async ({
		freshChatPage,
		freshHistoryPage,
		freshUserAccount,
	}) => {
		const owner = freshUserAccount.address;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Conversation to delete and re-sync');

		const convs = await waitForGraph(() => getConversations(owner), c => c.length === 1, {
			label: 'conversation indexed',
		});
		const convId = convs[0].id;
		const before = await getConversation(convId);
		expect(before).not.toBeNull(); // baseline must exist, else the CID-change check is vacuous
		const baselineCid = before!.conversationMetadataCID;

		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1);
		await freshHistoryPage.deleteConversation(0);
		await freshHistoryPage.assertConversationCount(0, { timeout: 30_000 });

		// Cross-layer: the soft-delete is a metadata update → the metadata CID changes (the
		// subgraph's isDeleted stays false; the deletion flag is in the encrypted metadata).
		await waitForGraph(
			() => getConversation(convId),
			c => c != null && c.conversationMetadataCID !== baselineCid,
			{ label: 'delete metadata update indexed' },
		);

		// dApp: leave and re-enter History (re-mount → re-sync from remote). It STAYS deleted — the
		// dApp decrypts the new metadata's isDeleted flag and keeps it hidden, rather than re-adding
		// the still-present Conversation entity from the graph.
		await freshChatPage.goto();
		await freshHistoryPage.goto();
		// Gate on the History list having mounted (search control is always present) so the count
		// assertion can't pass in the transient empty loading state before the re-sync has run.
		await expect(freshHistoryPage.searchInput).toBeVisible({ timeout: 10_000 });
		await freshHistoryPage.assertConversationCount(0, { timeout: 15_000 });
	});
});
