// @vitest-environment node
//
// Static guard over e2e/: no private-key literal for a real network may be committed.
//
// Testnet mode derives every ephemeral account from a per-run seed that lives only in the
// runner's environment, and the treasury key comes from Secret Manager. The only key literals
// the suite may contain are Hardhat's published dev-mnemonic accounts, which are worthless on
// any real chain. A 64-hex literal that is NOT one of those is either a real key or a hash;
// a hash is marked as such on its line and the guard lets it through.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { findPrivateKeyLiterals, HARDHAT_DEV_KEYS } from '../helpers/key-literals';

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARDHAT_ACCT1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const SUSPECT_KEY = `0x${'5a'.repeat(32)}`;

describe('findPrivateKeyLiterals', () => {
	const dirs: string[] = [];
	const scratch = (files: Record<string, string>): string => {
		const dir = mkdtempSync(path.join(tmpdir(), 'key-literals-'));
		dirs.push(dir);
		for (const [rel, body] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			writeFileSync(path.join(dir, rel), body, 'utf8');
		}
		return dir;
	};
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	it('knows all twenty Hardhat dev-mnemonic keys, including the two the suite names outright', () => {
		expect(HARDHAT_DEV_KEYS.size).toBe(20);
		expect(HARDHAT_DEV_KEYS.has(HARDHAT_ACCT1_KEY)).toBe(true);
		expect(
			HARDHAT_DEV_KEYS.has('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
		).toBe(true);
	});

	it('lets a Hardhat dev key through', () => {
		const dir = scratch({ 'a.ts': `const k = '${HARDHAT_ACCT1_KEY}';\n` });
		expect(findPrivateKeyLiterals(dir)).toEqual([]);
	});

	it('flags any other 64-hex literal with its file and line', () => {
		const dir = scratch({ 'deep/b.ts': `// one\nconst k = '${SUSPECT_KEY}';\n` });
		expect(findPrivateKeyLiterals(dir)).toEqual([{ file: 'deep/b.ts', line: 2 }]);
	});

	it('never repeats the literal it found — the report must not become the leak', () => {
		const dir = scratch({ 'b.ts': `const k = '${SUSPECT_KEY}';\n` });
		expect(JSON.stringify(findPrivateKeyLiterals(dir))).not.toContain('5a5a5a5a');
	});

	it('lets a line marked as a hash through, case-insensitively', () => {
		const dir = scratch({
			'c.ts': [
				`const tx = '${SUSPECT_KEY}'; // tx-hash`,
				`const topic = '${SUSPECT_KEY}'; // not-a-key: Transfer event topic`,
			].join('\n'),
		});
		expect(findPrivateKeyLiterals(dir)).toEqual([]);
	});

	it('ignores the all-zero word, which is an ABI zero value, not a key', () => {
		const dir = scratch({ 'd.ts': `const z = '0x${'00'.repeat(32)}';\n` });
		expect(findPrivateKeyLiterals(dir)).toEqual([]);
	});

	it('scans ts, js, json and md but skips node_modules and generated run state', () => {
		const dir = scratch({
			'e.md': `key ${SUSPECT_KEY}`,
			'f.json': `{"k":"${SUSPECT_KEY}"}`,
			'node_modules/x.ts': `'${SUSPECT_KEY}'`,
			'.auth/user.json': `{"k":"${SUSPECT_KEY}"}`,
			'g.png': SUSPECT_KEY,
		});
		expect(
			findPrivateKeyLiterals(dir)
				.map(h => h.file)
				.sort(),
		).toEqual(['e.md', 'f.json']);
	});
});

describe('no real-network private key literal in e2e/', () => {
	it('finds nothing to report', () => {
		const hits = findPrivateKeyLiterals(E2E_DIR);
		expect(
			hits,
			`Private-key-shaped literals that are not Hardhat dev keys:\n${hits
				.map(h => `  ${h.file}:${h.line}`)
				.join(
					'\n',
				)}\nIf a line holds a hash, mark it with a trailing "// tx-hash" or "// not-a-key: <why>".`,
		).toEqual([]);
	});
});
