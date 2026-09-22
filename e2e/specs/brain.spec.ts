import { expect, test } from '../fixtures';
import { BRAIN_PG_SKIP_REASON, readBrainPgConfig, waitForLedger } from '../helpers/brain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';

// Area 24 — the Brain. Until now the suite passed whether the Brain worked or was entirely
// absent: the oracle's `recordAnswerActivity` found no Postgres, logged nothing, and returned.
// These specs close that hole from the cheap end.
//
// The WRITE path is not gated on MOCK_AI. `MOCK_AI` short-circuits `queryAIModel` only;
// `recordAnswerActivity` runs from the answer-submission path either way. So this asserts real
// Brain behaviour on the deterministic shard at zero LLM cost — the read path (sentiment/macro/
// news injection) needs MOCK_AI=false and lives in the opt-in real-AI run.

test.describe('Brain activity ledger (T-BRAIN)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.skip(readBrainPgConfig() === null, BRAIN_PG_SKIP_REASON);

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-BRAIN-01: an answered prompt writes exactly one oracle answer row to the Brain ledger', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('What is the sentiment on ABLE right now?');

		// The ledger write follows escrow settlement, so it lags the rendered answer — poll.
		// `targetId` is the user wallet and every test claims a fresh account (ADR-0002), so
		// these rows belong to this test alone even though the DB is shared across the suite.
		const rows = await waitForLedger(
			freshUserAccount.address,
			r => r.some(row => row.kind === 'answer'),
			{ label: 'oracle answer row recorded' },
		);

		const answers = rows.filter(row => row.kind === 'answer');
		// Exactly one, not "at least one": `recordActivity` dedups on `content_hash`, seeded
		// `oracle:<kind>:<answerMessageId>`. A second row for one answer would mean the seed had
		// stopped being unique per answer — which is the bug that prefix exists to prevent, and it
		// would be invisible to a `some()` assertion.
		//
		// Scope of what this proves: it DETECTS a broken dedup (two rows fail the length check)
		// but does not PROVOKE one. A true collision needs the same kind AND the same
		// answerMessageId — a regeneration mints a new id, and the case the `oracle:` prefix
		// actually guards is an oracle-internal retry recording `answer_failed` then `answer`.
		// Neither is reachable from the dApp layer these specs drive; provoking it deliberately
		// belongs in an oracle-side unit test.
		expect(answers).toHaveLength(1);
		expect(answers[0].platform).toBe('oracle');
		// Shape, not just presence: `content_hash` is sha256(contentSeed) truncated to 32 hex
		// chars, and the unique index that makes the dedup above work is on exactly that
		// column. `toBeTruthy()` would also accept a UUID, a raw seed string or a stray 'x'.
		// The seed itself (`oracle:answer:<answerMessageId>`) is NOT recoverable from here —
		// it hashes one-way and the id is not carried in metadata — so the seed format is
		// pinned oracle-side in answerActivity.test.js, not from the dApp.
		expect(answers[0].content_hash).toMatch(/^[0-9a-f]{32}$/);
	});

	test('T-BRAIN-02: the ledger row carries the conversation and prompt ids the answer settled against', async ({
		freshUserAccount,
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse('Summarise the macro backdrop for ABLE.');

		const rows = await waitForLedger(
			freshUserAccount.address,
			r => r.some(row => row.kind === 'answer'),
			{ label: 'oracle answer row recorded' },
		);
		const answer = rows.find(row => row.kind === 'answer');

		// metadata is the only place the on-chain ids survive into the ledger. Asserting they are
		// present and numeric-stringy proves the oracle passed the real ids through rather than
		// the `null`s `recordAnswerActivity` falls back to when its caller omits them — a
		// degradation that would otherwise look identical to a healthy row.
		// Stated explicitly rather than leaning on `?.`: the waitForLedger predicate above
		// guarantees an answer row, but that invariant is invisible here, and `answer?.metadata`
		// would report a missing ROW as a missing METADATA field.
		expect(answer, 'waitForLedger predicate guarantees an answer row').toBeDefined();
		expect(answer!.metadata).toBeTruthy();
		const metadata = answer!.metadata as { conversationId?: unknown; promptMessageId?: unknown };
		expect(String(metadata.conversationId ?? '')).toMatch(/^\d+$/);
		expect(String(metadata.promptMessageId ?? '')).toMatch(/^\d+$/);
	});
});
