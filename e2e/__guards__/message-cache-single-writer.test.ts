// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A conversation's stored messages are written in one place: `writeMessageCache`.
 *
 * Several things write the same row (a prompt being sent, a sync, a branch rebuilding its
 * history, a cancel). When each put back the list it had read, whichever wrote last dropped
 * what another had stored in between, and the user's message vanished until the next sync.
 * The single writer re-reads inside a transaction and merges again when the row changed. A
 * direct `put`, `bulkPut` or `update` on the table bypasses that, so it is forbidden here.
 * Deleting a whole conversation's row is not a merge and stays allowed.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const THE_WRITER = path.join(SRC, 'lib', 'messageCacheStore.ts');

const DIRECT_WRITE = /\bmessageCache\s*\.\s*(put|bulkPut|update|add|bulkAdd|modify)\b/;
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

describe('stored messages have one writer', () => {
	it('nothing in src/ writes the messageCache table except the writer itself', () => {
		const offenders = listSourceFiles(SRC)
			.filter(file => file !== THE_WRITER)
			.filter(file => DIRECT_WRITE.test(stripComments(readFileSync(file, 'utf8'))));

		expect(offenders.map(f => path.relative(ROOT, f))).toEqual([]);
	});

	it('the writer still writes the table, so this guard is looking at the right name', () => {
		expect(DIRECT_WRITE.test(stripComments(readFileSync(THE_WRITER, 'utf8')))).toBe(true);
	});
});
