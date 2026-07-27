import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3002';

// Load the generated localnet env so Node-side specs/helpers see the same
// contract addresses (VITE_*_CONTRACT_ADDRESS) the dApp uses. Without this the
// stateful specs that gate on those addresses silently skip (see #26).
dotenv.config({ path: path.resolve(__dirname, '.env.localnet') });

export default defineConfig({
	testDir: './e2e/specs',

	/**
	 * Global setup runs before any tests. When E2E_LOCAL_SERVICES=1 is set,
	 * it verifies that Hardhat, Graph node, and the subgraph endpoint are reachable.
	 * If any are down, it fails fast with a clear error instead of confusing timeouts.
	 */
	globalSetup: path.resolve(__dirname, './e2e/global-setup.ts'),

	/**
	 * Run tests in parallel within a file. Each test gets its own browser context
	 * so there is no shared state between tests.
	 */
	fullyParallel: true,

	/** Fail the build on CI if you accidentally left test.only in */
	forbidOnly: !!process.env.CI,

	/**
	 * One local retry, two on CI. Local was 0, which had a non-obvious cost: `trace` below
	 * is 'on-first-retry', so with no retry a LOCAL failure produced NO trace — only a
	 * screenshot and video. That is why the first sighting of the graph-node wedge
	 * (CU-86d3uqgh7) could not be diagnosed from its artifacts and needed a live repro.
	 *
	 * A retry also makes non-determinism legible: Playwright reports a test that passes on
	 * the second attempt as FLAKY rather than passed, so it is surfaced rather than hidden.
	 * Treat "green" as 0 failed AND 0 flaky — a flaky count above zero is a finding, not a
	 * pass.
	 */
	retries: process.env.CI ? 2 : 1,

	/**
	 * The localnet stateful run shares global chain state across specs — one Hardhat
	 * node, a shared Account #1 (cached-auth fixtures), owner-only setPromptFee, and
	 * global evm_snapshot/evm_revert. None of that is safe across parallel workers:
	 * nonce races on the deployer (account 0), cross-project balance/plan races on the
	 * shared Account #1 (e.g. the faucet/plan specs need it at 0 ABLE while others fund
	 * it), and snapshots are global so a concurrent revert corrupts another project.
	 * So the E2E_LOCAL_SERVICES run is SERIAL (workers=1); mocked (non-localnet) runs
	 * parallelise normally. Full per-worker parallelism would need a chain-per-worker +
	 * all-fresh-accounts + no global snapshots — tracked as a CU-86d3a04rr follow-up.
	 */
	workers: process.env.E2E_LOCAL_SERVICES === '1' ? 1 : process.env.CI ? 2 : undefined,

	reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

	use: {
		baseURL: BASE_URL,
		/** Default assertion timeout — tight enough to catch regressions */
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		viewport: { width: 1280, height: 800 },
	},

	/**
	 * Automatically start the dApp dev server if it isn't already running.
	 * In CI the server is always started fresh; locally an existing server is reused.
	 * The Hardhat node, oracle, and Graph node must be started manually — see
	 * docs/LOCALNET_SETUP.md.
	 */
	webServer: {
		command: 'bun run dev',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},

	projects: [
		{
			name: 'smoke',
			testMatch: '**/smoke.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'ui',
			testMatch: '**/ui.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'auth',
			testMatch: '**/auth.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'plan',
			testMatch: '**/plan.spec.ts',
			fullyParallel: false,
			// Snapshot-revert specs now wait for the subgraph to re-sync in afterEach
			// (each mini-reorg unwind takes seconds; see revertToSnapshot) — the 30s
			// default would abort the hook mid-wait.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'faucet',
			testMatch: '**/faucet.spec.ts',
			fullyParallel: false,
			// Snapshot-revert specs now wait for the subgraph to re-sync in afterEach
			// (each mini-reorg unwind takes seconds; see revertToSnapshot) — the 30s
			// default would abort the hook mid-wait.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'chat',
			testMatch: '**/chat.spec.ts',
			fullyParallel: false,
			// Answer-flow specs drive a real fresh connect + the full oracle → IPFS →
			// subgraph → dApp render round-trip (the POMs wait up to 90s). The default
			// 30s per-test timeout would abort mid-round-trip, so give them headroom.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'cost',
			testMatch: '**/contract-cost.spec.ts',
			fullyParallel: false,
			// T-COST-03 sends two prompts and waits for the first answer to render
			// (thinking → hidden, up to 90s) before the second — same headroom need.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'cancel',
			testMatch: '**/cancel.spec.ts',
			fullyParallel: false,
			// Each test holds a prompt pending (8s mock-oracle delay) and T-CANCEL-03 then
			// runs a full answer round-trip — give headroom over the 30s default.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'versions',
			testMatch: '**/versions.spec.ts',
			fullyParallel: false,
			// Each T-REGEN/T-EDIT test does a prompt round-trip THEN a regenerate/edit
			// round-trip (two oracle → IPFS → subgraph → dApp cycles, POMs wait up to 90s
			// each), so it needs more headroom than the single-round-trip chat specs.
			timeout: 240_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'history',
			testMatch: '**/history.spec.ts',
			fullyParallel: false,
			// Data tests do a full chat round-trip (fresh connect + prompt + answer) before
			// touching history; the 30s default would abort mid-round-trip.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'refunds',
			testMatch: '**/refunds.spec.ts',
			fullyParallel: false,
			// T-REFUND-03 does a dropped-prompt round-trip + indexing, then waits for useStuckRequests'
			// 15s refetch to re-evaluate the wall-clock gate, then a refund round-trip + indexing —
			// past the 30s default, so give it the same headroom as the other round-trip specs.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'search',
			testMatch: '**/search.spec.ts',
			fullyParallel: false,
			// Creates conversations via full chat round-trips before searching; 30s default aborts.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'metadata',
			testMatch: '**/metadata.spec.ts',
			fullyParallel: false,
			// Two oracle round-trips (the answer, then the rename/delete metadata update) plus
			// indexing waits and a re-sync — worst-case well past 120s, so match the versions
			// project's headroom.
			timeout: 240_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'reasoning',
			testMatch: '**/reasoning.spec.ts',
			fullyParallel: false,
			// Each test does a full prompt → answer round-trip before asserting the reasoning/sources
			// disclosure, so it needs the same headroom as the other answer-flow specs.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'multi-device',
			testMatch: '**/multi-device.spec.ts',
			fullyParallel: false,
			// Each test boots TWO fresh devices (connect + session sign each) around a full prompt →
			// answer round-trip and a cross-device sync, so it needs more headroom than the
			// single-device answer specs.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'live-sync',
			testMatch: '**/live-sync.spec.ts',
			fullyParallel: false,
			// Two devices (connect + session sign each) plus a full prompt → answer round-trip on
			// device B, then a live-convergence window on device A — same headroom as multi-device.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'activity',
			testMatch: '**/activity.spec.ts',
			fullyParallel: false,
			// T-ACTIVITY-02/03 do a full prompt → answer round-trip before asserting the indexed
			// Activity row + its dashboard label, plus a 60s indexing wait — same headroom as the
			// other answer-flow projects.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'features',
			testMatch: '**/remaining-features.spec.ts',
			fullyParallel: false,
			// T-STUCK does a dropped-prompt round-trip + indexing wait before the dashboard assertion;
			// T-PENDING-01 does a full answer round-trip AND a dropped prompt + indexing wait before its
			// dashboard/history assertions (so it needs more than the single-round-trip headroom);
			// T-ONBOARD/T-THEME are quick.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'governance',
			testMatch: '**/governance.spec.ts',
			fullyParallel: false,
			// Owner-only setters + subgraph-index waits + answer round-trips. T-GOV-ORACLE-02 is the
			// heaviest: it holds a prompt's answer (20s sentinel), rotates mid-flight, waits past the
			// delay, then waits up to 60s for the orphaned PENDING state to index — so give extra
			// headroom over the other answer-flow projects.
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'security',
			testMatch: '**/security.spec.ts',
			// T-SEC-06/08 drive a full prompt round-trip before inspecting storage —
			// same headroom need as the other answer-flow projects.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'graph',
			testMatch: '**/graph.spec.ts',
			fullyParallel: false,
			// Snapshot-revert specs now wait for the subgraph to re-sync in afterEach
			// (each mini-reorg unwind takes seconds; see revertToSnapshot) — the 30s
			// default would abort the hook mid-wait.
			timeout: 120_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'sentry',
			testMatch: '**/sentry.spec.ts',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'branching',
			testMatch: '**/branching.spec.ts',
			fullyParallel: false,
			// Branch tests do multiple chat round-trips plus a branch op, then wait up to 60s for
			// graph-node to index the branch before the follow-on assertions; generous headroom.
			timeout: 240_000,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'mobile',
			testMatch: '**/ui.spec.ts',
			use: { ...devices['Pixel 5'] },
		},
	],
});
