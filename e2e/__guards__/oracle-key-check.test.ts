import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

/**
 * The oracle key check (`src/lib/oracleKeyCheck.ts`, `src/hooks/useOracleKeyCheck.ts`) is only
 * worth something if it reads the key the oracle really publishes, stops every action that
 * wraps the session key for the oracle, and never lets a key leave the page. Each of these
 * is a property of the source that no rendered test sees, so this reads the source.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const code = (file: string) => stripComments(readFileSync(path.join(SRC, file), 'utf8'));

const HOOK = path.join('hooks', 'useOracleKeyCheck.ts');
const CHECK = path.join('lib', 'oracleKeyCheck.ts');
const MUTATIONS = path.join('hooks', 'useChatMutations.tsx');

/** Each `useMutation` in the chat mutations, by the name it is assigned to. */
function mutationBodies(source: string): Map<string, string> {
	const starts = [...source.matchAll(/\n\tconst (\w+) = useMutation\s*(?:<[^>]*>)?\(/g)];
	const end = source.indexOf('\n\treturn {', starts.at(-1)?.index ?? 0);
	return new Map(
		starts.map((match, i) => [
			match[1],
			source.slice(match.index, starts[i + 1]?.index ?? (end === -1 ? undefined : end)),
		]),
	);
}

describe('the guard finds every mutation', () => {
	it('whether or not it is written with type arguments', () => {
		const source =
			'\n\tconst one = useMutation({ a });\n\tconst two = useMutation<A, B>({ b });\n\treturn { one, two };';
		expect([...mutationBodies(source).keys()]).toEqual(['one', 'two']);
	});

	it('counts as many as the file calls', () => {
		const source = code(MUTATIONS);
		const calls = source.match(/\buseMutation\s*(?:<[^>]*>)?\(/g) ?? [];
		expect(calls.length).toBeGreaterThan(0);
		expect(mutationBodies(source).size).toBe(calls.length);
	});
});

describe('the oracle key check reads the chain', () => {
	it('reads the agent getter with an eth_call, through thirdweb', () => {
		const hook = code(HOOK);
		expect(hook).toMatch(/\breadContract\(/);
		expect(hook).toContain('AGENT_ORACLE_KEY_GETTER');
		expect(hook).toMatch(/CONTRACTS\[chain\.id\]\?\.agent/);
		expect(code(CHECK)).toContain("AGENT_ORACLE_KEY_GETTER = 'oracleEncryptionKey'");
	});

	it.each([HOOK, CHECK])('%s never asks the subgraph, which is not trusted for this', file => {
		expect(code(file)).not.toMatch(/graph|subgraph|gql|VITE_GRAPH/i);
	});

	it('compares with the key the encryption uses', () => {
		expect(code(HOOK)).toContain('import.meta.env.VITE_ORACLE_PUBLIC_KEY');
		expect(code(MUTATIONS)).toContain('import.meta.env.VITE_ORACLE_PUBLIC_KEY');
	});

	it('asks again on the same cadence as the fee token check', () => {
		expect(code(HOOK)).toMatch(/const ORACLE_KEY_RECHECK_MS = 5 \* 60 \* 1000;/);
		expect(code(HOOK)).toMatch(/refetchInterval: ORACLE_KEY_RECHECK_MS,/);
	});
});

describe('every action that wraps the session key is stopped by a disagreement', () => {
	const mutations = code(MUTATIONS);
	// Read from the source, not imported: the check loads the build's contract settings, which
	// the e2e type check does not know.
	const listed = code(CHECK).match(
		/export const KEY_WRAPPING_ACTIONS: readonly PaidAction\[\] = \[([^\]]*)\];/,
	);
	const KEY_WRAPPING_ACTIONS = [...(listed?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1]);

	it('reads the list of actions the check stops', () => {
		expect(KEY_WRAPPING_ACTIONS.length).toBeGreaterThan(0);
		expect(KEY_WRAPPING_ACTIONS).not.toContain('plan');
	});

	it('wraps the key only in the chat mutations', () => {
		const files = sourceFiles(SRC, f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)).filter(
			f => /\bcreateEncryptedPayloads\(/.test(code(f)),
		);
		expect(files).toEqual([MUTATIONS]);
	});

	it('each mutation that wraps the key refuses, first, for an action the check stops', () => {
		const wrapping = [...mutationBodies(mutations)].filter(([, body]) =>
			body.includes('createEncryptedPayloads('),
		);
		expect(wrapping.map(([name]) => name).sort()).toEqual(
			[
				'branchConversationMutation',
				'initiatePromptMutation',
				'metadataUpdateMutation',
				'regenerateMutation',
			].sort(),
		);
		wrapping.forEach(([name, body]) => {
			const asked = body.match(/\n\s*refuseIfSwitchedOff\('(\w+)'\);/);
			expect(asked, `${name} does not ask the gate`).not.toBeNull();
			expect(KEY_WRAPPING_ACTIONS, name).toContain(asked?.[1]);
			expect(asked?.index ?? Infinity, `${name} wraps the key before it asks`).toBeLessThan(
				body.indexOf('createEncryptedPayloads('),
			);
		});
	});
});

describe('no key leaves the page', () => {
	it.each([HOOK, CHECK])('%s writes nothing to the console', file => {
		expect(code(file)).not.toMatch(/\bconsole\./);
	});

	it('reports to Sentry by kind only, with the oracle-key tag', () => {
		const hook = code(HOOK);
		const reports = [...hook.matchAll(/Sentry\.captureException\(([^;]+)\);/g)].map(m => m[1]);
		expect(reports.length).toBeGreaterThan(0);
		reports.forEach(report => {
			expect(report).toContain("check: 'oracle-key'");
			expect(report).not.toMatch(/VITE_ORACLE_PUBLIC_KEY|buildKey|onChain|published|error\b/);
		});
		// What is reported is a new error named after the kind, never the read's own error.
		expect(hook).not.toMatch(/captureException\(error/);
		expect(hook).not.toContain('failureReport(');
	});

	it('no other source file reads the check', () => {
		const readers = sourceFiles(SRC, f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)).filter(
			f => /(?<!function )\buseOracleKeyCheck\(\)/.test(code(f)),
		);
		expect(readers).toEqual([path.join('hooks', 'usePaymentGate.ts')]);
	});
});
