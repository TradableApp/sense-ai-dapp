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

// The library itself, not its types: `import type { Table } from 'dexie'` opens nothing,
// and neither does re-exporting a type.
// A path under the package (`dexie/dist/...`) is the same library by another door, and so
// is an import for its side effects or one written with a template literal. Lines are read
// one at a time: an import whose `from 'dexie'` sits on its own line is still counted there,
// a type-only one split that way included, which errs on the strict side.
const DEXIE = '[\'"`]dexie(\\/[^\'"`]*)?[\'"`]';
const DEXIE_VALUE_IMPORT = new RegExp(
	`^(?!\\s*(?:import|export)\\s+type\\b).*\\bfrom\\s+${DEXIE}|\\b(require|import)\\s*\\(\\s*${DEXIE}|^\\s*import\\s+${DEXIE}`,
);

// The naming module, by its relative path or by the alias.
const NAMING_IMPORT = /import\{([^}]*)\}from['"](?:\.\/localStoreName|@\/lib\/localStoreName)['"]/;
// The name as a whole identifier. Read before whitespace is removed, so `const x` and a
// following name stay apart.
const NAMING_IDENTIFIER = /(?<![\w$])resolveLocalStoreName(?![\w$])/g;

/** Whether `flat` (whitespace removed) imports the naming function itself, under its own name. */
function importsNamingFunction(flat: string): boolean {
	const names = NAMING_IMPORT.exec(flat)?.[1].split(',') ?? [];
	return names.includes('resolveLocalStoreName');
}

/**
 * Whether the name appears exactly twice: in the import and in the call that names the
 * store. Any other appearance (a local declaration, a parameter, a destructured binding)
 * could stand in for the imported function, so it fails rather than being told apart.
 */
const namedOnlyByImportAndCall = (code: string): boolean =>
	(code.match(NAMING_IDENTIFIER) ?? []).length === 2;

/**
 * Whether `source` opens exactly one database, under the name the shared naming function
 * gives the build's chain id, agent address and mode. The function must be the one imported
 * from the naming module, which is the one the build check applies.
 */
function opensOneStoreNamedPerAgent(source: string): boolean {
	const code = stripComments(source);
	const flat = code.replace(/\s+/g, '');
	return (
		importsNamingFunction(flat) &&
		namedOnlyByImportAndCall(code) &&
		(flat.match(/newDexie\(/g) ?? []).length === 1 &&
		!/extendsDexie/.test(flat) &&
		flat.includes(
			'newDexie(resolveLocalStoreName(import.meta.env.VITE_CHAIN_ID,import.meta.env.VITE_AGENT_CONTRACT_ADDRESS,import.meta.env.MODE,),)',
		)
	);
}

// The shape of src/lib/db.ts that the guard accepts, for its self-test.
const OPENED_PER_AGENT = [
	"import Dexie from 'dexie';",
	"import { resolveLocalStoreName } from './localStoreName';",
	'const db = new Dexie(',
	'\tresolveLocalStoreName(',
	'\t\timport.meta.env.VITE_CHAIN_ID,',
	'\t\timport.meta.env.VITE_AGENT_CONTRACT_ADDRESS,',
	'\t\timport.meta.env.MODE,',
	'\t),',
	');',
].join('\n');

describe('local store is opened once, per agent', () => {
	it.each([
		"import Dexie from 'dexie';",
		"import { Dexie, type Table } from 'dexie';",
		'import Dexie from "dexie";',
		"import Dexie from 'dexie/dist/modern/dexie.mjs';",
		"import { liveQuery } from 'dexie/dist/dexie';",
		"const { Dexie } = await import('dexie');",
		"const { Dexie } = await import('dexie/dist/dexie');",
		"const Dexie = require('dexie');",
		"import 'dexie';",
		"import 'dexie/dist/dexie';",
		'const { Dexie } = await import(`dexie`);',
		"export { Dexie } from 'dexie';",
	])('counts %s as loading the library', line => {
		expect(DEXIE_VALUE_IMPORT.test(line)).toBe(true);
	});

	it.each([
		"import type { Table } from 'dexie';",
		"import type { Table } from 'dexie/dist/dexie';",
		"export type { Table } from 'dexie';",
		"export type { Table } from 'dexie/dist/dexie';",
		"import { db } from '@/lib/db';",
		"import { something } from 'dexie-like-name';",
		"import { something } from 'not-dexie';",
		"import 'dexie-like-name';",
		"import '@/lib/db';",
	])('does not count %s', line => {
		expect(DEXIE_VALUE_IMPORT.test(line)).toBe(false);
	});

	it('loads the database library only in src/lib/db.ts', () => {
		// Stricter than looking for `new Dexie(`: a subclass calling `super('name')` or an
		// aliased import would open a second database without those words.
		expect(
			offenders(SRC, file => isSource(file) && file !== DB_MODULE, DEXIE_VALUE_IMPORT),
		).toEqual([]);
	});

	it("opens one database, named from the build's chain id and agent address", () => {
		expect(opensOneStoreNamedPerAgent(read(SRC, DB_MODULE))).toBe(true);
	});

	it('accepts the store opened under the shared naming function', () => {
		expect(opensOneStoreNamedPerAgent(OPENED_PER_AGENT)).toBe(true);
		expect(
			opensOneStoreNamedPerAgent(
				OPENED_PER_AGENT.replace("'./localStoreName'", "'@/lib/localStoreName'"),
			),
		).toBe(true);
	});

	// The name must come from the function the build check applies. A local function of the
	// same name could name every agent's store the same and the build would not notice.
	it.each([
		[
			'a local function of the same name',
			OPENED_PER_AGENT.replace(
				"import { resolveLocalStoreName } from './localStoreName';",
				"const resolveLocalStoreName = (..._: unknown[]) => 'SenseAI';",
			),
		],
		[
			'the function imported from another module',
			OPENED_PER_AGENT.replace("'./localStoreName'", "'./storeName'"),
		],
		[
			'another function renamed to it',
			OPENED_PER_AGENT.replace(
				'{ resolveLocalStoreName }',
				'{ localStoreName as resolveLocalStoreName }',
			),
		],
		['a second database', `${OPENED_PER_AGENT}\nconst other = new Dexie('SenseAI');`],
		// The import is kept in these, so only a second binding of the name can fail them.
		[
			'a local declaration beside the import',
			`${OPENED_PER_AGENT}\nfunction resolveLocalStoreName() {\n\treturn 'SenseAI';\n}`,
		],
		[
			'a parameter that shadows the imported function',
			OPENED_PER_AGENT.replace(
				'const db = new Dexie(',
				'const open = (resolveLocalStoreName: (...names: unknown[]) => string) =>\n\tnew Dexie(',
			),
		],
		[
			'a destructured binding that shadows the imported function',
			OPENED_PER_AGENT.replace(
				'const db = new Dexie(',
				'const open = ({ resolveLocalStoreName }: Naming) =>\n\tnew Dexie(',
			),
		],
	])('refuses %s', (_, source) => {
		expect(opensOneStoreNamedPerAgent(source)).toBe(false);
	});

	it('checks the same two values, and the fee token, before a build or dev server starts', () => {
		// The store module is part of the first bundle, so a bad value there fails before
		// error reporting or any page exists. The build is stopped instead.
		const config = read(ROOT, 'vite.config.ts').replace(/\s+/g, '');

		expect(config).toContain("constenv=loadEnv(mode,process.cwd(),'VITE_');");
		expect(config).toContain('assertLocalStoreConfig(mode,env);');
		expect(config).toContain('assertFeeTokenConfig(mode,env);');
	});
});
