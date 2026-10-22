// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * No contract-log watching in the dApp (sense-ai-dapp#77).
 *
 * thirdweb's event hooks issue one `eth_getLogs` per watched event per block, plus a
 * 2000-block backfill on every mount and window focus. On Base's public endpoints that
 * trips the per-IP rate limit (a 429 storm, each surfaced as an unhandled rejection), and
 * mainnet.base.org refuses `eth_getLogs` outright. Live updates come from the escrow
 * state poller in `src/hooks/liveStateProbe.ts` instead. A well-meaning "just subscribe
 * to the event" would quietly bring the storm back, so the import is forbidden here.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

// Any identifier use (import, aliased import, call); prose in comments may name them.
// thirdweb's event hooks plus viem's log APIs and the raw RPC method.
const FORBIDDEN =
	/\b(useContractEvents|watchContractEvents|getContractEvents|watchContractEvent|watchEvent|getLogs|eth_getLogs)\b/;
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function listSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) return listSourceFiles(full);
		if (!/\.(ts|tsx|js|jsx)$/.test(name)) return [];
		if (/\.test\.(ts|tsx)$/.test(name)) return [];
		return [full];
	});
}

describe('no log watchers in src/', () => {
	it('never imports or calls a thirdweb contract-event watcher', () => {
		const offenders = listSourceFiles(SRC).filter(file => {
			const source = readFileSync(file, 'utf8');
			return FORBIDDEN.test(stripComments(source));
		});

		expect(offenders.map(f => path.relative(ROOT, f))).toEqual([]);
	});
});
