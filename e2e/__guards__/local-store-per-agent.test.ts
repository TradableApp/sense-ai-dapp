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

const ROOT = path.resolve(E2E_DIR, '..');
const SRC = path.join(ROOT, 'src');
const DB_MODULE = path.join('lib', 'db.ts');
const isSource = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\.(ts|tsx|js|jsx)$/.test(file);
const read = (...parts: string[]) => stripComments(readFileSync(path.join(...parts), 'utf8'));

// The library itself, not its types: `import type { Table } from 'dexie'` opens nothing.
const DEXIE_VALUE_IMPORT =
	/^(?!\s*import\s+type\b).*\bfrom\s+['"]dexie['"]|\b(require|import)\s*\(\s*['"]dexie['"]/;

describe('local store is opened once, per agent', () => {
	it('loads the database library only in src/lib/db.ts', () => {
		// Stricter than looking for `new Dexie(`: a subclass calling `super('name')` or an
		// aliased import would open a second database without those words.
		expect(
			offenders(SRC, file => isSource(file) && file !== DB_MODULE, DEXIE_VALUE_IMPORT),
		).toEqual([]);
	});

	it("opens one database, named from the build's chain id and agent address", () => {
		const source = read(SRC, DB_MODULE).replace(/\s+/g, '');

		expect(source.match(/newDexie\(/g) ?? []).toHaveLength(1);
		expect(source).not.toMatch(/extendsDexie/);
		expect(source).toContain(
			'newDexie(resolveLocalStoreName(import.meta.env.VITE_CHAIN_ID,import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,import.meta.env.MODE,),)',
		);
	});

	it('checks the same two values when a testnet or mainnet build starts', () => {
		// The store module is part of the first bundle, so a bad value there fails before
		// error reporting or any page exists. The build is stopped instead.
		const config = read(ROOT, 'vite.config.ts').replace(/\s+/g, '');

		expect(config).toMatch(
			/assertLocalStoreConfig\(mode,loadEnv\(mode,process\.cwd\(\),'VITE_'\)\)/,
		);
	});
});
