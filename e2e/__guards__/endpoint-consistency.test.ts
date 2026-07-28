import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The localnet endpoints must have ONE source of truth.
 *
 * `sync-config.sh` in sense-ai-e2e writes `VITE_CHAIN_RPC_URL` from `$PORT_HARDHAT` and
 * `VITE_THE_GRAPH_API_URL` from `$PORT_GRAPH`/`$SUBGRAPH_NAME`. Any helper that hardcodes a
 * port instead of reading those silently talks to the wrong place the moment the config
 * changes — and an unreachable endpoint tends to produce a *skipped* wait or a misattributed
 * failure rather than a loud error. That is exactly what the hardcoded subgraph URL did
 * (CU-86d3dwme6): the poller aimed at nothing, decided the graph was absent, and skipped the
 * serialization it existed to perform.
 *
 * `helpers/hardhat.ts` owns the canonical `RPC_URL`. `fixtures/mock-wallet.ts` deliberately
 * keeps its own read of the same variable rather than importing it, because that module is
 * stringified into a browser init script and must not pull in viem or node:child_process.
 * Reading the same variable means the two cannot diverge in VALUE — but the fallback literal
 * is duplicated, and nothing enforced that it stayed in sync. This does.
 */

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
	return readFileSync(path.join(E2E_DIR, rel), 'utf8');
}

/** Every `process.env.X || '<literal>'` pair in a file, as [envVar, literal]. */
function envFallbacks(src: string): Array<[string, string]> {
	return [...src.matchAll(/process\.env\.(\w+)\s*\|\|\s*['"]([^'"]+)['"]/g)].map(m => [m[1], m[2]]);
}

describe('localnet endpoints have one source of truth', () => {
	it('the RPC fallback is identical in helpers/hardhat.ts and fixtures/mock-wallet.ts', () => {
		const canonical = envFallbacks(read('helpers/hardhat.ts')).filter(
			([env]) => env === 'VITE_CHAIN_RPC_URL',
		);
		const mirrored = envFallbacks(read('fixtures/mock-wallet.ts')).filter(
			([env]) => env === 'VITE_CHAIN_RPC_URL',
		);

		expect(
			canonical.length,
			'helpers/hardhat.ts should define exactly one VITE_CHAIN_RPC_URL fallback (the canonical RPC_URL)',
		).toBe(1);
		expect(
			mirrored.length,
			'fixtures/mock-wallet.ts should define exactly one VITE_CHAIN_RPC_URL fallback (HARDHAT_RPC)',
		).toBe(1);

		expect(
			mirrored[0][1],
			`The RPC fallback literal is duplicated in these two files by design — mock-wallet.ts is ` +
				`stringified into a browser init script and must not import helpers/hardhat.ts (viem, ` +
				`node:child_process). They read the same env var so the VALUE cannot diverge, but the ` +
				`fallbacks must match. Update both, or drop one.`,
		).toBe(canonical[0][1]);
	});

	it('no e2e helper or fixture hardcodes an endpoint without an env override', () => {
		// A bare literal with no `process.env.… ||` in front of it is the defect this catches.
		const offenders: string[] = [];
		for (const rel of [
			'helpers/hardhat.ts',
			'helpers/graph.ts',
			'helpers/fresh-account.ts',
			'fixtures/mock-wallet.ts',
		]) {
			const src = read(rel);
			// Strip comments first: several of these files explain the hazard in prose, and a
			// literal quoted inside that prose is documentation, not a hardcoded endpoint.
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
			const fallbacks = new Set(envFallbacks(code).map(([, literal]) => literal));
			for (const m of code.matchAll(/['"](https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^'"]*)['"]/g)) {
				if (!fallbacks.has(m[1])) offenders.push(`${rel}: ${m[1]}`);
			}
		}
		expect(
			offenders,
			`These are hardcoded localnet endpoints with no env override. sync-config.sh derives the ` +
				`real values from $PORT_HARDHAT / $PORT_GRAPH, so a hardcoded one silently points at ` +
				`nothing when the config changes — which typically manifests as a skipped wait or a ` +
				`misattributed failure, not an error. Read the env var with the literal as fallback.`,
		).toEqual([]);
	});
});
