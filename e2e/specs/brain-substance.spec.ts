import { expect, test } from '../fixtures';
import { BRAIN_PG_SKIP_REASON, brainQuery, readBrainPgConfig } from '../helpers/brain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node + oracle + Graph node (set E2E_LOCAL_SERVICES=1)';
const REAL_AI_SKIP_REASON =
	'Skipped: costs money. Bring the stack up with E2E_REAL_AI=1 (oracle runs MOCK_AI=false) and run --project=brain-real';

// Area 24b — does the Brain's warm cache actually reach the answer?
//
// SEPARATE FROM brain.spec.ts ON PURPOSE. That one asserts the WRITE path and runs on the
// deterministic shard for free, because `recordAnswerActivity` is outside the MOCK_AI
// short-circuit. The READ path is not: MOCK_AI short-circuits `queryAIModel` before ElizaOS
// (and therefore plugin-senseai, and therefore the Brain accessor) is ever reached. So these
// need a real model, real spend, and an explicit opt-in — never the default.
test.describe('Brain market context reaches the answer (T-BRAIN-AI)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(process.env.E2E_REAL_AI !== '1', REAL_AI_SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');
	test.skip(readBrainPgConfig() === null, BRAIN_PG_SKIP_REASON);

	// Guard against the failure mode that would make every assertion below meaningless: an
	// unseeded cache. getLatestEnrichedNews returns [] and getLatestMacro returns null against
	// an empty database, the oracle answers with no market block at all, and "the answer does
	// not mention ZQXR-9" would then be a true statement about nothing. Fail here, loudly, with
	// the cause named — rather than three tests failing somewhere the cause is invisible.
	// Safe to call brainQuery unguarded here: Playwright does NOT run beforeAll when every
	// test in the describe is skipped by a describe-level test.skip. Verified empirically
	// against the pinned 1.59.1 — an all-skipped describe whose beforeAll throws reports
	// "2 skipped" and never enters the hook. Deliberately NOT wrapped in an
	// `if (!readBrainPgConfig()) return` guard: that would also swallow the canary check in
	// a run where the config IS present but the cache was never seeded, which is precisely
	// the failure this hook exists to make loud.
	test.beforeAll(async () => {
		const canary = await brainQuery(
			`SELECT 1 FROM senseai.market_news WHERE provider_id = 'seed-canary-001' AND tldr IS NOT NULL`,
		);
		expect(
			canary.length,
			'Brain warm cache is not seeded — run sense-ai-e2e/scripts/seed-brain-cache.sh. ' +
				'Without it these assertions pass or fail for reasons unrelated to the Brain.',
		).toBe(1);
	});

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-BRAIN-AI-01: the answer carries a fact that exists only in the seeded cache', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		// ZQXR-9 is a fabricated instrument. It is in no training corpus and nowhere else in
		// these repos — the ONLY way into an answer is the warm cache the Brain read. That is
		// what makes this unfakeable, where "the answer sounds market-aware" is not: a competent
		// model produces market-sounding prose with no context whatsoever.
		const answer = await freshChatPage.sendPromptAndWaitForResponse(
			'What changed with the ZQXR-9 settlement window, and when does it take effect?',
		);

		expect(answer).toBeTruthy();
		// The seeded TLDR says "T+0 settlement on 2026-10-01". Asserting one of those specifics
		// rather than the bare ticker: a model handed an unknown symbol can parrot the symbol
		// back out of the question, but it cannot invent the settlement detail that came with it.
		expect(answer).toMatch(/T\+0|2026-10-01|same[- ]day settlement/i);
	});

	test('T-BRAIN-AI-02: the answer reflects the seeded macro environment, not a neutral default', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		const answer = await freshChatPage.sendPromptAndWaitForResponse(
			'What is the current macro sentiment backdrop?',
		);

		expect(answer).toBeTruthy();
		// The fixture is deliberately extreme (Fear & Greed 17 / "Extreme Fear"). A neutral
		// fixture would be indistinguishable from getLatestMacro's own fallbacks (`?? 50`,
		// `|| "Neutral"`) firing on a row that never loaded — the assertion would hold whether
		// or not the Brain read anything.
		expect(answer).toMatch(/extreme fear|\b17\b|58\.25/i);
	});

	test('T-BRAIN-AI-03: the answer is synthesised prose, not a template or a bare acknowledgement', async ({
		freshChatPage,
	}) => {
		await freshChatPage.goto();
		const answer = await freshChatPage.sendPromptAndWaitForResponse(
			'Give me your read on the market right now.',
		);

		const text = (answer ?? '').trim();
		// Shaped after the hardened base-testnet smoke, which exists because the two failures
		// that actually shipped were a code fence echoed back and a one-line acknowledgement —
		// both of which satisfy "an answer arrived" and neither of which is an answer.
		expect(text.length).toBeGreaterThan(200);
		expect(text).not.toMatch(/^```/);
		expect(text).not.toMatch(
			/^(ok(ay)?|sure|got it|understood|thanks|noted|acknowledged)\b[\s.!]*$/i,
		);
		// The mock oracle's deterministic answer must never satisfy this suite: if it does, the
		// opt-in did not take effect and every assertion above is being graded against a canned
		// string rather than a model.
		//
		// Matched against the ACTUAL canned text (aiAgentOracle.js:1276), not the bare word
		// "mock". Market prose says "markets mocked the pivot" and "a mock relief rally" in
		// complete innocence, and a real answer failing on that would be a false accusation
		// that looks exactly like a genuine one.
		expect(text).not.toMatch(/^\[MOCK\]|deterministic mock response for local testing/i);
	});
});
