/**
 * Finds private-key-shaped literals (`0x` + 64 hex) in a tree, ignoring the Hardhat dev keys
 * and lines marked as hashes. Backs the `no-real-network-keys` guard; kept as a plain function
 * so the guard can prove on fixtures that it would catch a leak.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

/** Hardhat's published dev mnemonic — the only keys that may appear as literals anywhere. */
const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const HARDHAT_MANAGED_ACCOUNTS = 20;

export const HARDHAT_DEV_KEYS: ReadonlySet<string> = new Set(
	Array.from({ length: HARDHAT_MANAGED_ACCOUNTS }, (_, i) => {
		const key = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey;
		if (!key) throw new Error(`no private key derived for Hardhat account ${i}`);
		return toHex(key).toLowerCase();
	}),
);

const ZERO_WORD = `0x${'00'.repeat(32)}`;
const KEY_SHAPED = /0x[0-9a-fA-F]{64}\b/g;
/** A line that says what its 32-byte literal is (a hash, a topic) is not a key. */
const MARKED_NOT_A_KEY = /tx-hash|not-a-key/i;
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md']);
/** Dependencies and generated run state — not source, and the run state may hold a session. */
const SKIPPED_DIRS = new Set(['node_modules', '.auth', 'playwright-report', 'test-results']);

export interface KeyLiteralHit {
	/** POSIX path relative to the scanned root. The literal itself is deliberately absent. */
	file: string;
	line: number;
}

function listFiles(root: string, dir: string): string[] {
	return readdirSync(dir)
		.filter(name => !SKIPPED_DIRS.has(name))
		.flatMap(name => {
			const full = path.join(dir, name);
			if (statSync(full).isDirectory()) return listFiles(root, full);
			return SCANNED_EXTENSIONS.has(path.extname(name)) ? [full] : [];
		});
}

function lineHasForeignKey(line: string): boolean {
	if (MARKED_NOT_A_KEY.test(line)) return false;
	const literals = line.match(KEY_SHAPED) ?? [];
	return literals.some(lit => {
		const lower = lit.toLowerCase();
		return lower !== ZERO_WORD && !HARDHAT_DEV_KEYS.has(lower);
	});
}

export function findPrivateKeyLiterals(root: string): KeyLiteralHit[] {
	return listFiles(root, root).flatMap(file => {
		const lines = readFileSync(file, 'utf8').split('\n');
		return lines.flatMap((line, i) =>
			lineHasForeignKey(line)
				? [{ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1 }]
				: [],
		);
	});
}
