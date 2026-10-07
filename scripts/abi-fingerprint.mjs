/**
 * Fingerprint of a Hardhat artifact's INTERFACE.
 *
 * One implementation, imported by both sync-contracts.sh (which writes the value into
 * SOURCE.json) and abi-sync.test.ts (which recomputes and compares it). It used to exist twice —
 * an inline `bun -e` one-liner in the shell script and a near-identical helper in the test — so
 * the manifest's correctness depended on two copies agreeing. It also put the shell copy's
 * behaviour at the mercy of `bun -e`'s argv layout, which differs from Node's and which three
 * consecutive review rounds stopped to question.
 *
 * Hashes the parsed `abi`, not the file bytes: `prettier --write` must not red the test over
 * whitespace nobody depends on, and bytecode churn is the contract repo's concern, not the
 * dApp's.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function abiFingerprint(artifact) {
	return createHash('sha256').update(JSON.stringify(artifact.abi)).digest('hex');
}

export function fingerprintFile(path) {
	return abiFingerprint(JSON.parse(readFileSync(path, 'utf8')));
}

// CLI entry: `bun scripts/abi-fingerprint.mjs <artifact.json>`. argv[1] is the script path under
// both Node and Bun when a file is executed, so the artifact is argv[2] — no eval-mode ambiguity.
if (process.argv[1] && process.argv[1].endsWith('abi-fingerprint.mjs')) {
	const file = process.argv[2];
	if (!file) {
		process.stderr.write('usage: abi-fingerprint.mjs <artifact.json>\n');
		process.exit(1);
	}
	process.stdout.write(fingerprintFile(file));
}
