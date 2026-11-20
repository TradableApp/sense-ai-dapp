// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offenders, stripComments } from './source-scan';

/**
 * The browser's local store is one database per agent contract.
 *
 * Conversation ids are counted by the agent contract, so a newly deployed agent starts
 * again at 1. A store shared between agents would file the new agent's first conversation
 * under the same key as the old agent's first conversation, for the same wallet, and show
 * the two as one. The sync cursor lives in the same store and would also carry over, so the
 * new agent's history would never be fetched. The store is therefore opened in one place
 * only, under a name built from the chain and the agent address.
 */

const SRC = path.resolve(E2E_DIR, '..', 'src');
const DB_MODULE = path.join('lib', 'db.ts');
const isSource = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file);

describe('local store is opened once, per agent', () => {
	it('opens a Dexie database only in src/lib/db.ts', () => {
		expect(
			offenders(SRC, file => isSource(file) && file !== DB_MODULE, /new\s+Dexie\s*\(/),
		).toEqual([]);
	});

	it('names the database with localStoreName, never a fixed string', () => {
		const source = stripComments(readFileSync(path.join(SRC, DB_MODULE), 'utf8'));
		const opens = source.match(/new\s+Dexie\s*\(([^)]*)\)?/g) ?? [];

		expect(opens).toHaveLength(1);
		expect(opens[0]).toMatch(/new\s+Dexie\s*\(\s*localStoreName\(/);
	});
});
