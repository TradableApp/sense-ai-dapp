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
 * The single writer re-reads inside a transaction and merges again when the row changed.
 *
 * So outside the writer the table may only be read, or have a whole conversation's row
 * deleted. The uses allowed are listed, and every other mention of the table is an offence:
 * a list of forbidden methods misses `where(...).modify(...)`, `db.table('messageCache')`,
 * `db['messageCache']` and a table kept in a variable.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const THE_WRITER = path.join(SRC, 'lib', 'messageCacheStore.ts');

const TABLE = /\bmessageCache\b/g;
const ALLOWED_AFTER = [
	// The schema and the table's type.
	/^\s*:/,
	/^\s*\.\s*get\s*\(/,
	/^\s*\.\s*delete\s*\(/,
	/^\s*\.\s*where\s*\([^()]*\)\s*\.\s*toArray\s*\(/,
];
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Every mention of the table in `source` that is not one of the allowed uses. */
const otherUsesOfTheTable = (source: string): string[] => {
	const code = stripComments(source);
	return [...code.matchAll(TABLE)]
		.map(match => code.slice(match.index, match.index + 60))
		.filter(use => !ALLOWED_AFTER.some(allowed => allowed.test(use.slice('messageCache'.length))));
};

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
	it('nothing in src/ uses the messageCache table except to read it or delete a row', () => {
		const offenders = listSourceFiles(SRC)
			.filter(file => file !== THE_WRITER)
			.flatMap(file =>
				otherUsesOfTheTable(readFileSync(file, 'utf8')).map(
					use => `${path.relative(ROOT, file)}: ${use.split('\n')[0]}`,
				),
			);

		expect(offenders).toEqual([]);
	});

	it('the writer still writes the table, so this guard is looking at the right name', () => {
		expect(otherUsesOfTheTable(readFileSync(THE_WRITER, 'utf8')).join('\n')).toMatch(
			/messageCache\s*\.\s*put\s*\(/,
		);
	});

	it.each([
		'await db.messageCache.put(row);',
		'await db.messageCache.bulkPut(rows);',
		'await db.messageCache.update(key, changes);',
		'await db.messageCache.where({ ownerAddress }).modify(change);',
		'await db.messageCache.toCollection().modify(change);',
		'await db.messageCache.clear();',
		'await db.messageCache.bulkDelete(keys);',
		"await db.table('messageCache').put(row);",
		"await db['messageCache'].put(row);",
		'const table = db.messageCache;',
		'const { messageCache } = db;',
	])('counts %s as a use of the table that is not allowed', source => {
		expect(otherUsesOfTheTable(source)).not.toEqual([]);
	});

	it.each([
		'const row = await db.messageCache.get([ownerAddress, conversationId]);',
		'const rows = await db.messageCache.where({ ownerAddress }).toArray();',
		'await db.messageCache.delete([ownerAddress, conversationId]);',
		"messageCache: '[ownerAddress+conversationId]',",
		'messageCache: Table<MessageRecord>;',
		'// await db.messageCache.put(row);',
		"import { writeMessageCache } from './messageCacheStore';",
	])('allows %s', source => {
		expect(otherUsesOfTheTable(source)).toEqual([]);
	});
});
