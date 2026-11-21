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
 * refuses a second press while the first is in flight (its local save included).
 */
const HISTORY = path.resolve(E2E_DIR, '..', 'src', 'features', 'history', 'History.tsx');
const code = stripComments(readFileSync(HISTORY, 'utf8'));

describe('rename and delete in the history', () => {
	it('are sent through the one-at-a-time sender', () => {
		expect(code).toMatch(/useOneMetadataSend\(\s*metadataUpdateMutation\.mutate\s*\)/);
	});

	it('are never sent by calling the mutation directly', () => {
		expect(code).not.toMatch(/metadataUpdateMutation\.mutate\s*\(/);
		expect(code).not.toMatch(/metadataUpdateMutation\.mutateAsync\b/);
	});
});
