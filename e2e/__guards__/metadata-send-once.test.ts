// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

/**
 * Rename and delete are paid: History sends them only through `useOneMetadataSend`, which
 * refuses a second press while the first is in flight (its local save included). In flight is
 * read from the query client by the mutation's key, so leaving the history and coming back
 * mid-send does not give a fresh lock.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const read = (...parts: string[]) => stripComments(readFileSync(path.join(SRC, ...parts), 'utf8'));
const code = read('features', 'history', 'History.tsx');
const lock = read('features', 'history', 'useOneMetadataSend.ts');
const mutations = read('hooks', 'useChatMutations.tsx');

describe('rename and delete in the history', () => {
	it('are sent through the one-at-a-time sender', () => {
		expect(code).toMatch(/useOneMetadataSend\(\s*metadataUpdateMutation\.mutate\s*\)/);
	});

	it('are never sent by calling the mutation directly', () => {
		expect(code).not.toMatch(/metadataUpdateMutation\.mutate\s*\(/);
		expect(code).not.toMatch(/metadataUpdateMutation\.mutateAsync\b/);
	});
});

describe('the rename and delete lock', () => {
	it('is keyed by the mutation the history sends', () => {
		expect(lock).toContain("export const METADATA_SEND_KEY = ['metadata-send'];");
		expect(mutations).toMatch(
			/const metadataUpdateMutation = useMutation\(\{\s*mutationKey: \['metadata-send'\],/,
		);
		expect(mutations.match(/\['metadata-send'\]/g) ?? []).toHaveLength(1);
	});

	it('reads the query client for a send in flight, not a per-component ref', () => {
		expect(lock).toMatch(
			/queryClient\.isMutating\(\{\s*mutationKey: METADATA_SEND_KEY\s*\}\)\s*>\s*0/,
		);
		expect(lock).not.toMatch(/\buseRef\b/);
	});
});
