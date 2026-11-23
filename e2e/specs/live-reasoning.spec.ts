import { type BrowserContext, type Page, type Request } from '@playwright/test';

import { expect, test } from '../fixtures';
import { BUDGET } from '../helpers/budgets';
import { CHAIN, LIVE_STACK, LIVE_STACK_SKIP_REASON } from '../helpers/chain';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';
import { openDevice } from '../helpers/devices';
import { freshAccountPool } from '../helpers/fresh-account';
import { getConversations, getPromptRequests, waitForGraph } from '../helpers/graph';
import { STORED_ANSWER } from '../pages/ChatPage';

// Live reasoning: while an answer is awaited, the dApp reads the oracle's sealed frames for it
// (GET <stream address>/stream/<answerMessageId>, proof of key in a request header) and shows the
// steps, sources and the provisional answer as an overlay. Once the stored answer lands, the stored
// record is what is shown, and a difference from what was shown live is reported to Sentry (tag
// `check: live-reasoning`).
//
// Localnet: the mock oracle's sentinels make the frames known in advance (tokenized-ai-agent
// oracle/src/aiAgentOracle.js):
//   __E2E_REASONING__     two fixed sources, then two fixed steps, sent through the stream; the
//                         stored record is the projection of those frames.
//   __E2E_STEP_MS__:<n>   waits <n> ms (cap 5000) before each step, so steps can be seen arriving.
//   __E2E_DELAY_MS__:<n>  holds the mock answer <n> ms (cap 30000) AFTER the steps, which keeps
//                         the answer awaited while the test looks at the live view.
//   __E2E_RERUN__         new prompts only: the first run sends the sources and one step, ends
//                         interrupted, and the prompt is run again at once as a second run that
//                         opens with a reset.
//
// Testnet: a real oracle decides its own steps; only T-STREAM-01 and T-STREAM-06 run, with
// structural assertions. They need a hosted build with the stream address set.
//
// The specs never read the stream address: a stream request is recognised by its path alone.
// Fresh account per test, no snapshot (docs/E2E-ISOLATION-MODEL.md rule 1); serial.

/** The mock oracle's fixed step titles, in order (MOCK_E2E_REASONING). */
const MOCK_STEP_TITLES = ['Interpreting the request', 'Synthesising the answer'];
/** The mock oracle's first fixed source (MOCK_E2E_SOURCES). */
const MOCK_SOURCE = { title: 'Tradable Documentation', href: 'https://tradable.app/docs' };

/** The stream route of the contract: `/stream/` + a decimal answer id, optional `?mode=poll`. */
const STREAM_PATH = /\/stream\/\d+(?:\?|$)/;
/** The proof header; Playwright gives header names in lower case. */
const PROOF_HEADER = 'x-senseai-stream-proof';
/** base64url of a 32-byte HMAC, no padding. */
const PROOF_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reopening a stored conversation after a reload reads the local store (no chain, no storage):
 * the same window history.spec allows for it, doubled for a page that has just re-derived its key.
 */
const STORED_REOPEN_MS = 30_000;
/**
 * A stream stopped by the page (conversation left) is aborted in the effect's cleanup, at once;
 * 5 s is slack for the browser to report the cancelled request, not time the app needs.
 */
const STREAM_CLOSE_MS = 5_000;

const TESTNET_ONLY_TWO =
	'Skipped on testnet: only the mock oracle can be told what to stream (T-STREAM-01 and -06 run there)';

// ── In-page observation ─────────────────────────────────────────────────────

interface LiveSnapshot {
	/** Titles of the current attempt's live steps, in order (earlier attempts excluded). */
	titles: string[];
	/** The "Earlier attempt" trigger's text when shown, e.g. "Earlier attempt (1 step)". */
	earlier: string | null;
	/** Whether the "Retrying" notice is shown. */
	retrying: boolean;
	/** The provisional answer's text when one is shown. */
	provisional: string | null;
	/** The provisional mark's visible name ("Not yet confirmed") when shown. */
	mark: string | null;
	/** Whether an error toast is shown. Toasts close by themselves, so only a record sees one. */
	errorToast: boolean;
	/** How many stored answers are shown: the moment this rises is the stored answer landing. */
	stored: number;
}

declare global {
	// eslint-disable-next-line no-unused-vars
	interface Window {
		__liveSnapshots?: LiveSnapshot[];
	}
}

/**
 * Records every distinct state of the live view from now until the page is reloaded. A
 * MutationObserver sees each React commit, so a state that lasts one render (a reset that clears
 * the steps before the next run's first step) is recorded even if no assertion polls at that moment.
 * Installed before the prompt is sent, it covers the whole time the answer is awaited, so a spec
 * asserts on what was shown then rather than racing the stored answer with reads of its own.
 */
async function watchLiveView(page: Page): Promise<void> {
	await page.evaluate(storedAnswer => {
		const read = () => {
			const roots = [...document.querySelectorAll('[data-testid="live-reasoning"]')];
			const titles = roots.flatMap(root =>
				[...root.querySelectorAll('[data-testid="reasoning-step"]')]
					.filter(step => !step.closest('[data-testid="reasoning-earlier-attempt"]'))
					.map(step => step.querySelector('h4')?.textContent?.trim() ?? ''),
			);
			const earlier =
				roots
					.map(root =>
						root
							.querySelector('[data-testid="reasoning-earlier-attempt"] button')
							?.textContent?.trim(),
					)
					.find(Boolean) ?? null;
			const retrying = document.querySelector('[data-testid="live-retrying"]') !== null;
			// textContent, not innerText: read on every mutation, it must not force a layout.
			const provisional =
				document
					.querySelector('[data-testid="live-provisional-answer"] .prose')
					?.textContent?.trim() ?? null;
			const mark =
				document.querySelector('[data-testid="live-provisional-mark"]')?.textContent?.trim() ??
				null;
			const errorToast = document.querySelector('[data-sonner-toast][data-type="error"]') !== null;
			const stored = document.querySelectorAll(storedAnswer).length;
			return { titles, earlier, retrying, provisional, mark, errorToast, stored };
		};
		const snapshots: LiveSnapshot[] = [read()];
		window.__liveSnapshots = snapshots;
		const record = () => {
			const next = read();
			if (JSON.stringify(next) !== JSON.stringify(snapshots.at(-1))) snapshots.push(next);
		};
		// Runs in the page, where the observer is a browser global.
		new window.MutationObserver(record).observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
	}, STORED_ANSWER);
}

async function liveSnapshots(page: Page): Promise<LiveSnapshot[]> {
	return page.evaluate(() => window.__liveSnapshots ?? []);
}

/** The last live state that showed steps: what the user saw just before the stored answer. */
function lastShown(snapshots: LiveSnapshot[]): LiveSnapshot | undefined {
	return snapshots.filter(s => s.titles.length > 0).at(-1);
}

/**
 * The index of the first snapshot that shows the stored answer, after at least one that did not:
 * proof that the record spans the stored answer landing, so "never shown while awaited" is a
 * statement about the awaited period and not about a record that started too late.
 */
function landedAt(snapshots: LiveSnapshot[]): number {
	const landed = snapshots.findIndex(s => s.stored > 0);
	expect(snapshots[0]?.stored, 'the record began before the stored answer landed').toBe(0);
	expect(landed, 'the record saw the stored answer land').toBeGreaterThan(0);
	return landed;
}

/** The stored record as the page shows it: the open disclosure's step titles (no live view). */
async function storedSteps(page: Page): Promise<Pick<LiveSnapshot, 'titles' | 'earlier'>> {
	return page.evaluate(() => {
		const titles = [...document.querySelectorAll('[data-testid="reasoning-step"]')]
			.filter(step => !step.closest('[data-testid="reasoning-earlier-attempt"]'))
			.map(step => step.querySelector('h4')?.textContent?.trim() ?? '');
		const earlier =
			document
				.querySelector('[data-testid="reasoning-earlier-attempt"] button')
				?.textContent?.trim() ?? null;
		return { titles, earlier };
	});
}

// ── Network observation ─────────────────────────────────────────────────────

interface Traffic {
	/** Every request URL the page made, in order. */
	urls: string[];
	/** Every GET to the stream route. */
	streams: Request[];
	/** Stream requests neither finished nor failed yet. */
	open: Set<Request>;
	/** Statuses of stream responses (headers received). */
	statuses: number[];
	/** Sentry envelopes that carry a live reasoning report. */
	liveReports: string[];
	/** Every request body the page sent (Sentry envelopes included). */
	bodies: string[];
}

const isSentryPost = (req: Request) =>
	req.method() === 'POST' && (req.url().includes('sentry.io') || req.url().includes('ingest'));
const LIVE_REPORT = /"check"\s*:\s*"live-reasoning"/;

/** Starts recording the page's traffic. Register before the prompt is sent. */
function watchTraffic(page: Page): Traffic {
	const traffic: Traffic = {
		urls: [],
		streams: [],
		open: new Set(),
		statuses: [],
		liveReports: [],
		bodies: [],
	};
	const isStream = (req: Request) => req.method() === 'GET' && STREAM_PATH.test(req.url());
	page.on('request', req => {
		traffic.urls.push(req.url());
		const body = req.postData();
		if (body) traffic.bodies.push(body);
		if (isStream(req)) {
			traffic.streams.push(req);
			traffic.open.add(req);
		}
		if (isSentryPost(req) && LIVE_REPORT.test(req.postData() ?? '')) {
			traffic.liveReports.push(req.url());
		}
	});
	page.on('response', res => {
		if (isStream(res.request())) traffic.statuses.push(res.status());
	});
	page.on('requestfinished', req => traffic.open.delete(req));
	page.on('requestfailed', req => traffic.open.delete(req));
	return traffic;
}

/** The proof header of every stream request made so far. */
async function proofsOf(traffic: Traffic): Promise<string[]> {
	const headers = await Promise.all(traffic.streams.map(req => req.allHeaders()));
	return headers.map(h => h[PROOF_HEADER] ?? '');
}

/**
 * The proof is a bearer of access to the answer's frames: it travels in its header and nowhere
 * else. Checks every URL the page requested, the stream's own included, and every request body
 * (a report or a log line reaches Sentry as a POST body).
 */
async function expectProofOnlyInHeader(traffic: Traffic): Promise<void> {
	const proofs = await proofsOf(traffic);
	expect(proofs.length, 'at least one stream request was made').toBeGreaterThan(0);
	for (const proof of proofs) expect(proof).toMatch(PROOF_SHAPE);
	const leaked = traffic.urls.filter(
		url => /senseai-stream-proof/i.test(url) || proofs.some(proof => url.includes(proof)),
	);
	expect(leaked, 'no request URL carries the proof or its header name').toEqual([]);
	const inBodies = traffic.bodies.filter(body => proofs.some(proof => body.includes(proof)));
	expect(inBodies.length, 'no request body carries the proof').toBe(0);
}

/**
 * No live reasoning report reached Sentry. Meaningful only with a DSN in the build; without one
 * the report path is off and the check says so in the test's annotations instead of passing on
 * nothing.
 */
function expectNoLiveReport(traffic: Traffic): void {
	if (!process.env.VITE_SENTRY_DSN) {
		test.info().annotations.push({
			type: 'no-report check',
			description:
				'VITE_SENTRY_DSN not set: Sentry is off, so the absence of a report proves nothing',
		});
		return;
	}
	expect(traffic.liveReports, 'no Sentry event tagged check: live-reasoning').toEqual([]);
}

// ── Specs ───────────────────────────────────────────────────────────────────

test.describe('Live reasoning stream (T-STREAM)', () => {
	test.skip(!LIVE_STACK, LIVE_STACK_SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test('T-STREAM-01: steps show while the answer is awaited, and equal the stored steps after a reload', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
		freshHistoryPage,
	}) => {
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);
		await watchLiveView(freshPage);

		const liveSteps = freshPage.getByTestId('live-reasoning').getByTestId('reasoning-step');
		if (CHAIN === 'testnet') {
			// A real question a real oracle researches; its steps are its own.
			await freshChatPage.sendPrompt(
				'What drove Bitcoin price momentum this week? Cite your sources.',
			);
			// The live view exists only while the answer has no stored content (AssistantReasoning
			// shows live steps only while thinking), so a visible live step is a step seen while the
			// answer was awaited.
			await expect(
				liveSteps.first(),
				'a live step: is the stream address set in the hosted build?',
			).toBeVisible({ timeout: BUDGET.answerMs });
		} else {
			// Steps 2 s apart (step 1 at ~2 s, step 2 at ~4 s after the oracle opens the job), then the
			// answer held 6 s: both steps are on screen for at least ~6 s before the answer can be
			// uploaded, submitted and synced.
			await freshChatPage.sendPrompt(
				'Explain recent BTC momentum __E2E_REASONING__ __E2E_STEP_MS__:2000 __E2E_DELAY_MS__:6000',
			);
			await expect(liveSteps).toHaveCount(MOCK_STEP_TITLES.length, { timeout: BUDGET.answerMs });
		}

		// The stored answer lands on the same page and the live view goes.
		await expect(freshChatPage.assistantMessages).toHaveCount(1, { timeout: BUDGET.answerMs });
		await expect(freshChatPage.regenerateButton).toBeVisible({ timeout: BUDGET.answerMs });
		await expect(freshPage.getByTestId('live-reasoning')).toHaveCount(0);

		const shown = lastShown(await liveSnapshots(freshPage));
		expect(shown, 'live steps were recorded').toBeDefined();
		if (CHAIN !== 'testnet') expect(shown?.titles).toEqual(MOCK_STEP_TITLES);
		await expectProofOnlyInHeader(traffic);

		// A reload empties memory: what shows next is the stored record only, with no stream.
		await freshPage.reload();
		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1, { timeout: STORED_REOPEN_MS });
		await freshHistoryPage.clickConversation(0);
		await expect(freshChatPage.assistantMessages).toHaveCount(1, { timeout: STORED_REOPEN_MS });
		await expect(freshPage.getByTestId('live-reasoning')).toHaveCount(0);
		await freshChatPage.expandReasoning();
		await expect(freshPage.getByTestId('reasoning-step').first()).toBeVisible();

		const stored = await storedSteps(freshPage);
		expect(stored.titles, 'stored steps equal the steps shown live').toEqual(shown?.titles);
		expect(stored.earlier, 'earlier attempts equal too').toEqual(shown?.earlier ?? null);
		expectNoLiveReport(traffic);
	});

	test('T-STREAM-02: a re-run clears the first run on its reset, and its final steps are stored', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
		freshHistoryPage,
	}) => {
		test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);
		await watchLiveView(freshPage);

		// Run 1: sources, 2 s, step 1, then ends interrupted. Run 2 starts at once with a reset,
		// waits 2 s before its own step 1 (so the cleared view lasts about 2 s), step 2 at ~4 s,
		// and holds the answer 4 s more.
		await freshChatPage.sendPrompt(
			'Explain recent BTC momentum __E2E_REASONING__ __E2E_RERUN__ __E2E_STEP_MS__:2000 __E2E_DELAY_MS__:4000',
		);
		await expect(freshChatPage.regenerateButton).toBeVisible({ timeout: BUDGET.answerMs });

		const snapshots = await liveSnapshots(freshPage);
		const firstRun = snapshots.findIndex(
			s => JSON.stringify(s.titles) === JSON.stringify(MOCK_STEP_TITLES.slice(0, 1)),
		);
		expect(firstRun, "the first run's step was shown").toBeGreaterThanOrEqual(0);
		const reset = snapshots.findIndex((s, i) => i > firstRun && s.titles.length === 0);
		expect(reset, "the first run's step disappeared on the reset").toBeGreaterThan(firstRun);
		// A reset clears the step; an attempt frame would move it under "Earlier attempt", which
		// also takes the current titles to none. Only the reset leaves nothing marked earlier.
		expect(
			snapshots.slice(firstRun).map(s => s.earlier),
			'the re-run was taken as a reset, not as an attempt',
		).toEqual(snapshots.slice(firstRun).map(() => null));
		const finalRun = snapshots.findIndex(
			(s, i) => i > reset && s.titles.length === MOCK_STEP_TITLES.length,
		);
		expect(finalRun, "the second run's steps were shown").toBeGreaterThan(reset);
		expect(snapshots[finalRun].titles).toEqual(MOCK_STEP_TITLES);
		// The interrupted run is marked "Retrying" before the reset clears it, even if both frames
		// arrive in one network read: each frame is decrypted (Web Crypto, which resolves in a task
		// of its own) and folded one after another (liveAnswerSession's queue), and each fold
		// publishes its state, so the two land in separate renders and the observer records both.
		expect(
			snapshots.slice(firstRun, reset).some(s => s.retrying),
			'"Retrying" was shown between the interrupted run and the reset',
		).toBe(true);

		await freshPage.reload();
		await freshHistoryPage.goto();
		await freshHistoryPage.assertConversationCount(1, { timeout: STORED_REOPEN_MS });
		await freshHistoryPage.clickConversation(0);
		await expect(freshChatPage.assistantMessages).toHaveCount(1, { timeout: STORED_REOPEN_MS });
		await freshChatPage.expandReasoning();
		await expect(freshPage.getByTestId('reasoning-step').first()).toBeVisible();
		const stored = await storedSteps(freshPage);
		expect(stored.titles, "the second run's steps are the stored ones").toEqual(
			lastShown(snapshots)?.titles,
		);
		// Only the run that submitted is stored: one attempt, nothing marked earlier.
		expect(stored.earlier).toBeNull();
		expectNoLiveReport(traffic);
	});

	test('T-STREAM-03: a plain prompt opens the stream and shows no steps and no disclosure', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
	}) => {
		test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);
		await watchLiveView(freshPage);

		await freshChatPage.sendPrompt('A plain question with no reasoning');
		await expect(freshChatPage.regenerateButton).toBeVisible({ timeout: BUDGET.answerMs });

		expect(traffic.streams.length, 'the stream was requested').toBeGreaterThan(0);
		// The oracle opens a stream for every job, plain ones included (a reset, then the answer
		// and done), so the request is answered with the event stream at least once, not only 404s.
		expect(traffic.statuses, 'the stream was opened').toContain(200);
		expect((await liveSnapshots(freshPage)).every(s => s.titles.length === 0)).toBe(true);
		await expect(freshPage.getByTestId('live-reasoning')).toHaveCount(0);
		await expect(freshChatPage.reasoningTrigger).toHaveCount(0);
		await expect(freshChatPage.sourcesTrigger).toHaveCount(0);
	});

	test.describe('on a second device', () => {
		const openContexts: BrowserContext[] = [];
		const accounts = freshAccountPool();
		test.afterEach(async () => {
			await Promise.all(openContexts.splice(0).map(c => c.close().catch(() => {})));
			await accounts.releaseAll();
		});

		test('T-STREAM-04: a second device on the same account sees the same live steps', async ({
			browser,
		}) => {
			test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
			const account = await accounts.claim();
			await fundAndActivatePlan(account.address);

			// A conversation is indexed only once its first answer lands, so device B can open it only
			// after a first round trip; the live part is the second prompt.
			const deviceA = await openDevice(browser, account, openContexts);
			await deviceA.chat.goto();
			await deviceA.chat.sendPromptAndWaitForResponse('First prompt on device A');
			await waitForGraph(
				() => getConversations(account.address),
				convs => convs.length === 1,
				{ label: 'conversation indexed' },
			);

			const deviceB = await openDevice(browser, account, openContexts);
			await deviceB.history.goto();
			await deviceB.history.assertConversationCount(1, { timeout: STORED_REOPEN_MS });
			await deviceB.history.clickConversation(0);
			await expect(deviceB.chat.userMessages).toHaveCount(1, { timeout: STORED_REOPEN_MS });
			await watchLiveView(deviceA.page);
			await watchLiveView(deviceB.page);

			// Steps at ~3 s and ~6 s after the oracle opens the job, then the answer held 20 s: the
			// stored answer cannot land before ~26 s. B learns of the pending prompt from the subgraph
			// (its probe sees the pending count change on the prompt's block, then it syncs), well
			// inside that; and a late connection is replayed the run from its first frame.
			await deviceA.chat.sendPrompt(
				'Second prompt __E2E_REASONING__ __E2E_STEP_MS__:3000 __E2E_DELAY_MS__:20000',
			);
			const liveStepsOn = (page: Page) =>
				page.getByTestId('live-reasoning').getByTestId('reasoning-step');
			await expect(liveStepsOn(deviceA.page)).toHaveCount(MOCK_STEP_TITLES.length, {
				timeout: BUDGET.answerMs,
			});
			await expect(liveStepsOn(deviceB.page)).toHaveCount(MOCK_STEP_TITLES.length, {
				timeout: BUDGET.answerMs,
			});

			const onA = lastShown(await liveSnapshots(deviceA.page));
			const onB = lastShown(await liveSnapshots(deviceB.page));
			expect(onA?.titles).toEqual(MOCK_STEP_TITLES);
			expect(onB?.titles, 'device B shows the steps device A shows').toEqual(onA?.titles);

			// Both pages end on the stored answer, so nothing is left awaited at teardown.
			await expect(deviceA.chat.assistantMessages).toHaveCount(2, { timeout: BUDGET.answerMs });
			await expect(deviceB.chat.assistantMessages).toHaveCount(2, { timeout: BUDGET.answerMs });
		});
	});

	test('T-STREAM-05: with the stream unreachable the answer still lands through the sync, with no error shown', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
	}) => {
		test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);
		await watchLiveView(freshPage);
		let aborted = 0;
		await freshPage.route(STREAM_PATH, route => {
			aborted += 1;
			return route.abort('connectionrefused');
		});

		await freshChatPage.sendReasoningPrompt('Explain recent BTC momentum');

		// The route really matched: without this the test would pass with the stream simply on.
		expect(aborted, 'stream requests were refused').toBeGreaterThan(0);
		expect(traffic.statuses).toEqual([]);
		// Read from the record of the whole awaited period, not after the stored answer landed (by
		// then the live view cannot exist and a toast may have closed by itself).
		const snapshots = await liveSnapshots(freshPage);
		const landed = landedAt(snapshots);
		const awaited = snapshots.slice(0, landed);
		expect(
			awaited.filter(s => s.titles.length > 0),
			'no live step',
		).toEqual([]);
		expect(
			awaited.filter(s => s.retrying),
			'no "Retrying"',
		).toEqual([]);
		expect(
			awaited.filter(s => s.provisional !== null),
			'no provisional answer',
		).toEqual([]);
		expect(
			snapshots.filter(s => s.errorToast),
			'no error toast, at any time',
		).toEqual([]);
		// The stored answer still carries its reasoning: the record does not depend on the stream.
		await expect(freshChatPage.reasoningTrigger).toBeVisible({ timeout: 15_000 });
	});

	test('T-STREAM-06: the provisional answer shows before the synced one, with identical text', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
	}, testInfo) => {
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);
		await watchLiveView(freshPage);

		await freshChatPage.sendPrompt(
			CHAIN === 'testnet'
				? 'In one sentence, what is Bitcoin?'
				: 'A plain question for the provisional answer',
		);

		// The answer frame goes after the oracle's submitAnswer receipt; the stored answer needs that
		// block indexed and its payload fetched, so the frame arrives first. How long the provisional
		// answer stays up is the stack's to decide, so nothing is read from the page while it is up:
		// the record holds what it showed, and when, against the stored answer's arrival.
		const provisional = freshPage.getByTestId('live-provisional-answer');
		await expect(freshChatPage.assistantMessages).toHaveCount(1, { timeout: BUDGET.answerMs });
		await expect(provisional).toHaveCount(0);
		await expect(freshChatPage.regenerateButton).toBeVisible();

		const snapshots = await liveSnapshots(freshPage);
		const landed = landedAt(snapshots);
		const shownLive = snapshots
			.slice(0, landed)
			.filter(s => s.provisional !== null && s.provisional.length > 0);
		expect(
			shownLive.length,
			'a provisional answer while awaited: is the stream address set?',
		).toBeGreaterThan(0);
		expect(shownLive.map(s => s.mark)).toEqual(shownLive.map(() => 'Not yet confirmed'));
		// Never both at once: the provisional bubble is shown only while the stored answer is not.
		expect(snapshots.filter(s => s.provisional !== null && s.stored > 0)).toEqual([]);
		const provisionalText = shownLive.at(-1)?.provisional ?? '';
		// Read once, at once: the stored answer replaces the provisional one already in full. Had it
		// been typed again, this read would catch it part-way. One `.prose` in scope: the reasoning
		// disclosure and the sources are siblings of the stored bubble (Chat.tsx), not inside it.
		const storedText = (
			(await freshChatPage.latestAiMessage.locator('.prose').textContent()) ?? ''
		).trim();
		expect(storedText, 'the stored answer equals the provisional one').toBe(provisionalText);

		// The lead time: from the answer frame to the stored answer landing (useLiveReasoning).
		await expect
			.poll(
				() =>
					freshPage.evaluate(
						() =>
							performance
								.getEntriesByType('measure')
								.filter(e => e.name.startsWith('live-answer-lead:')).length,
					),
				{ timeout: 5_000 },
			)
			.toBe(1);
		const lead = await freshPage.evaluate(() => {
			const measure = performance
				.getEntriesByType('measure')
				.find(e => e.name.startsWith('live-answer-lead:'));
			const id = measure?.name.slice('live-answer-lead:'.length) ?? '';
			const live = performance.getEntriesByName(`live-answer:${id}`)[0]?.startTime ?? NaN;
			const stored = performance.getEntriesByName(`stored-answer:${id}`)[0]?.startTime ?? NaN;
			return { durationMs: measure?.duration ?? NaN, live, stored };
		});
		expect(lead.live).toBeLessThan(lead.stored);
		expect(lead.durationMs).toBeGreaterThan(0);
		const description = `${Math.round(lead.durationMs)} ms on ${CHAIN}`;
		testInfo.annotations.push({ type: 'live-answer-lead', description });
		console.log(`[T-STREAM-06] provisional answer shown ${description} before the stored one`);
		expectNoLiveReport(traffic);
	});

	// The other half, a link that is not http(s) being refused, cannot be driven end to end: the
	// oracle drops such a source before it sends or stores one. Unit tests hold it on both sides:
	// the frame schema here, the oracle's source cleaning there.
	test('T-STREAM-07: a source link in the live steps is a real http(s) link', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
	}) => {
		test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();

		// Step 1 at ~3 s, step 2 at ~6 s, answer held 15 s more: the live panel stays for ~15 s,
		// time to open its sources.
		await freshChatPage.sendPrompt(
			'Explain recent BTC momentum __E2E_REASONING__ __E2E_STEP_MS__:3000 __E2E_DELAY_MS__:15000',
		);
		const live = freshPage.getByTestId('live-reasoning');
		await expect(live.getByTestId('reasoning-step').first()).toBeVisible({
			timeout: BUDGET.answerMs,
		});
		await live.getByRole('button', { name: /used \d+ sources?/i }).click();
		const links = live.getByRole('link');
		await expect(links.first()).toBeVisible();
		for (const href of await links.evaluateAll(els => els.map(el => el.getAttribute('href')))) {
			expect(href).toMatch(/^https?:\/\//);
		}
		await expect(live.getByRole('link', { name: MOCK_SOURCE.title })).toHaveAttribute(
			'href',
			MOCK_SOURCE.href,
		);
		// Still the live view: the stored answer has not landed.
		await expect(freshChatPage.regenerateButton).toHaveCount(0);
	});

	test('T-STREAM-08: leaving the conversation closes the stream request', async ({
		freshUserAccount,
		freshPage,
		freshChatPage,
	}) => {
		test.skip(CHAIN === 'testnet', TESTNET_ONLY_TWO);
		test.skip(
			process.env.VITE_REASONING_STREAM_MODE === 'poll',
			'Skipped in poll mode: each request is short, so none is reliably open when the conversation is left',
		);
		await fundAndActivatePlan(freshUserAccount.address);
		await freshChatPage.goto();
		await freshChatPage.assertComposerReady();
		const traffic = watchTraffic(freshPage);

		// Step 1 at ~3 s; the answer is held until ~26 s after the job opens, so the stream is
		// still needed when the conversation is left.
		await freshChatPage.sendPrompt(
			'Explain recent BTC momentum __E2E_REASONING__ __E2E_STEP_MS__:3000 __E2E_DELAY_MS__:20000',
		);
		await expect(
			freshPage.getByTestId('live-reasoning').getByTestId('reasoning-step').first(),
		).toBeVisible({ timeout: BUDGET.answerMs });
		expect(traffic.open.size, 'a stream request is open').toBeGreaterThan(0);

		// "Reset Chat" leaves the conversation in the page (no reload); the answer is still awaited.
		await freshChatPage.startNewConversation();
		// Chromium reports a fetch aborted mid-body as a failed request, which is what empties
		// `open` (seen on localnet runs with both fee tokens).
		await expect
			.poll(() => traffic.open.size, { timeout: STREAM_CLOSE_MS, intervals: [250] })
			.toBe(0);
		const streamsWhenLeft = traffic.streams.length;

		// Nothing reopens it while the answer is completed elsewhere: wait for the chain to record
		// the answer (the whole time a stream would otherwise still be wanted) and count again.
		await waitForGraph(
			() => getPromptRequests(freshUserAccount.address),
			rows => rows.some(r => r.isAnswered),
			{ label: 'prompt answered', timeoutMs: BUDGET.answerMs },
		);
		expect(traffic.streams.length, 'no stream was opened after leaving').toBe(streamsWhenLeft);
		expect(traffic.open.size).toBe(0);
	});
});
