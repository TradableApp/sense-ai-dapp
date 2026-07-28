// @vitest-environment node
//
// Static analysis over source files: pure Node APIs, zero browser APIs. The repo default
// is happy-dom, which works here only incidentally (it layers on Node rather than
// replacing it) and misrepresents what this file needs. Set per-file rather than via
// config, since environmentMatchGlobs is deprecated in this vitest version.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ADR-0002 enforcement — see docs/decisions/0002-e2e-isolation-fresh-account.md.
 *
 * `evm_revert` rewinds the chain, which graph-node treats as a reorg. Its block ingestor
 * then polls for a block that no longer exists, gets a zero hash, and enters a permanent
 * retry loop ("Block data unavailable, block was likely uncled") — the subgraph FREEZES.
 * From that point every test that reads through the subgraph fails, including tests in
 * later projects that never used a snapshot themselves.
 *
 * Measured 2026-07-27 on an idle machine: subgraph pinned at block 97 while the chain
 * advanced to 121, and within cancel.spec.ts the failures were exactly the tests doing
 * indexed reads (T-CANCEL-01/03 failed, T-CANCEL-02/04 passed) — a 4/4 split on subgraph
 * dependence alone.
 *
 * So the rule is not stylistic: a spec may use snapshot/revert OR read the subgraph, never
 * both. `plan` is the sole permitted snapshot user because it advances EVM time with
 * `increaseTime`, which cannot be undone on a forward-only chain, and it reads no indexed
 * data.
 *
 * This guard exists because the violation is invisible in review — it produces failures in
 * OTHER files, run-order dependent, and looks like flakiness. Two full 75-minute runs and
 * nine bot review findings failed to attribute it.
 */

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = path.join(E2E_DIR, 'specs');

/** playwright.config.ts's `testDir`, as this guard assumes it. Asserted below rather than
 *  merely documented: if a second test directory is ever added, or this one moves, specs
 *  there would escape enforcement entirely — and the "has specs to inspect" count would keep
 *  passing on the files still in e2e/specs. Enforcing it converts a silent coverage gap into
 *  a failing test that names the fix. */
const ASSUMED_TEST_DIR = './e2e/specs';

/** The one spec ADR-0002 exempts, with the reason it qualifies. */
const PERMITTED_SNAPSHOT_SPECS = new Set(['plan.spec.ts']);

/** Calls that read through the subgraph, directly or via a rendered oracle answer. */
const INDEXED_READ_MARKERS = [
	'waitForGraph',
	'waitForIndexing',
	'getConversations',
	'getConversation(',
	'getMessages',
	'getPromptRequests',
	'getActivities',
	'getPayments',
	'getPendingPayments',
	'getRegenerationRequests',
	// An answer only renders once the subgraph has indexed it, so waiting on one is an
	// indexed read even when the spec imports nothing from helpers/graph.
	'sendPromptAndWaitForResponse',
	'sendReasoningPrompt',
	'assistantMessages',
	'latestAiMessage',
];

const SNAPSHOT_MARKERS = ['useChainSnapshot', 'takeSnapshot', 'revertToSnapshot'];

interface SpecFacts {
	file: string;
	snapshotCalls: string[];
	indexedReads: string[];
}

function readSpecs(): SpecFacts[] {
	// Recursive: readdirSync is shallow by default, so a spec moved into a subdirectory
	// (specs/cost/contract-cost.spec.ts) would silently escape enforcement — and the
	// minimum-count check below would still pass while the top-level count stayed high.
	// A guard that can silently stop covering files is the failure class this PR exists to
	// remove.
	return readdirSync(SPECS_DIR, { recursive: true })
		.filter((f): f is string => typeof f === 'string' && f.endsWith('.spec.ts'))
		.sort()
		.map(file => {
			const src = readFileSync(path.join(SPECS_DIR, file), 'utf8');
			// Strip comments AND string literals before matching. Comments first, so an
			// apostrophe inside prose cannot unbalance the string stripping. Without the string
			// pass, a marker name appearing inside a literal — e.g.
			// `const MSG = 'sendPromptAndWaitForResponse is called internally'` — would count as
			// an indexed read and falsely fail the exemption-honesty check on plan.spec.ts.
			// Stripping strings can only remove false positives: a marker that appears solely
			// inside a literal is not a call.
			const code = src
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/(^|[^:])\/\/.*$/gm, '$1')
				.replace(/`(?:\\.|[^`\\])*`/g, '``')
				.replace(/'(?:\\.|[^'\\])*'/g, "''")
				.replace(/"(?:\\.|[^"\\])*"/g, '""');
			return {
				file,
				snapshotCalls: SNAPSHOT_MARKERS.filter(m => code.includes(m)),
				indexedReads: INDEXED_READ_MARKERS.filter(m => code.includes(m)),
			};
		});
}

describe('ADR-0002: evm_snapshot/evm_revert must not be used by a spec that reads the subgraph', () => {
	it('has specs to inspect (guards against a silently-empty guard)', () => {
		const specs = readSpecs();
		expect(specs.length).toBeGreaterThan(15);
	});

	it('playwright still keeps all specs in the single directory this guard scans', () => {
		const config = readFileSync(path.join(E2E_DIR, '..', 'playwright.config.ts'), 'utf8');
		// Either quote style: a Prettier config change (or a hand edit) to double quotes would
		// otherwise yield [] and report "now declares []", which reads as "no testDir found"
		// rather than "wrong quote style" — a misleading failure on a guard whose job is clarity.
		const declared = [...config.matchAll(/testDir:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
		expect(
			declared,
			`This guard scans ${ASSUMED_TEST_DIR} only. playwright.config.ts now declares ` +
				`${JSON.stringify(declared)}. If a spec directory was added or moved, specs there ` +
				`escape ADR-0002 enforcement while the spec-count check keeps passing on the files ` +
				`still in e2e/specs — a silent coverage gap. Point SPECS_DIR at every declared ` +
				`testDir (make it an array and scan each) and update ASSUMED_TEST_DIR.`,
		).toEqual([ASSUMED_TEST_DIR]);
	});

	it('the exemption list still contains ONLY plan.spec.ts', () => {
		// The cheapest way to defeat this guard is to widen the allowlist rather than fix
		// the spec, and for a spec with no indexed reads of its own the check below would
		// not object — which is precisely the faucet.spec.ts trap in a new form. Pinning
		// the list makes widening it a deliberate, reviewable act instead of a one-word
		// edit. If you are here to add a spec: don't. Migrate it to fresh accounts. The
		// only reason plan qualifies is `increaseTime`, which a forward-only chain cannot
		// undo, combined with it reading nothing indexed AND running in its own invocation
		// (sense-ai-e2e SHARD_PLAN). A new entry would need all three to be true.
		expect([...PERMITTED_SNAPSHOT_SPECS].sort()).toEqual(['plan.spec.ts']);
	});

	it('only the permitted spec uses snapshot/revert at all', () => {
		// Deliberately stricter than "snapshots AND reads the subgraph". The wedge is GLOBAL:
		// once any revert freezes graph-node, every LATER spec's indexed reads fail, even
		// specs that never snapshotted. faucet.spec.ts is the case that proves the point —
		// it snapshots without reading the subgraph itself, so a per-spec rule would clear
		// it, while its reverts still freeze the graph for cost/cancel/versions downstream.
		const violations = readSpecs()
			.filter(s => s.snapshotCalls.length > 0)
			.filter(s => !PERMITTED_SNAPSHOT_SPECS.has(s.file));

		const detail = violations
			.map(v => {
				const reads = v.indexedReads.length
					? `own indexed reads: ${v.indexedReads.join(', ')}`
					: 'no indexed reads of its own — but its reverts still freeze the graph for later specs';
				return `  ${v.file}\n    snapshot: ${v.snapshotCalls.join(', ')}\n    ${reads}`;
			})
			.join('\n');

		expect(
			violations.map(v => v.file),
			`ADR-0002 violation — only plan.spec.ts may use evm_snapshot/evm_revert. A revert ` +
				`rewinds the chain, graph-node treats it as a reorg, its ingestor wedges on a ` +
				`zero-hash block, and the subgraph FREEZES for the rest of the invocation:\n${detail}\n\n` +
				`Fix: migrate to fresh-account-per-test (freshUserAccount + the fresh* page ` +
				`fixtures). plan.spec.ts is exempt only because it advances EVM time via ` +
				`increaseTime, which a forward-only chain cannot undo — and it is run in its own ` +
				`Playwright invocation so its reverts cannot reach a graph-asserting project.`,
		).toEqual([]);
	});

	it('the permitted spec really does avoid indexed reads (keeps the exemption honest)', () => {
		const specs = readSpecs();
		for (const file of PERMITTED_SNAPSHOT_SPECS) {
			const spec = specs.find(s => s.file === file);
			expect(spec, `${file} is on the ADR-0002 exemption list but does not exist`).toBeDefined();
			expect(
				spec?.indexedReads,
				`${file} is exempt from ADR-0002 only because it reads no indexed data. It now ` +
					`does, so either drop the indexed reads or migrate it off snapshot/revert.`,
			).toEqual([]);
		}
	});
});
