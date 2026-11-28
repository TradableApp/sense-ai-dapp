// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

/**
 * Every file the sync fetches that carries an identifier is checked against the slot it was
 * fetched for before it is used (`src/lib/storedFileSlot.ts`), and a conversation's messages
 * are stored under the conversation they were asked for. syncService.slots.test.ts proves the
 * behaviour; this keeps a later edit from fetching one of those files without the check.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const sync = stripComments(readFileSync(path.join(SRC, 'lib', 'syncService.ts'), 'utf8'));

describe('the files the sync fetches', () => {
	it.each([
		[
			'conversation',
			/hydrate\(conv\.conversationCID\)\.then\(payload =>\s*inSlot\(\s*payload,\s*file => conversationFileFits\(file, conv\.id\),\s*'conversation',?\s*\)/,
		],
		[
			'metadata',
			/hydrate\(conv\.conversationMetadataCID\)\.then\(payload =>\s*inSlot\(payload, metadataFileFits, 'metadata'\),?\s*\)/,
		],
		[
			'message',
			/hydrate\(msg\.messageCID\)\.then\(payload =>\s*inSlot\(\s*payload,\s*file => messageFileFits\(file, msg\.id, conv\.id\),\s*'message',?\s*\)/,
		],
		[
			'search delta',
			/hydrate\(msg\.searchDelta\?\.searchDeltaCID\)\.then\(payload =>\s*inSlot\(\s*payload,\s*delta => searchDeltaFits\(delta, msg\.id, conv\.id\),\s*'search-delta',?\s*\)/,
		],
	])('check a %s file against its slot', (_kind, pattern) => {
		expect(sync).toMatch(pattern);
	});

	it('fetch each kind in one place only', () => {
		expect(sync.match(/hydrate\(conv\.conversationCID\)/g) ?? []).toHaveLength(1);
		expect(sync.match(/hydrate\(msg\.messageCID\)/g) ?? []).toHaveLength(1);
		expect(sync.match(/hydrate\(msg\.searchDelta\?\.searchDeltaCID\)/g) ?? []).toHaveLength(1);
	});

	it('take only its own fields from the metadata file, and never skip an incomplete record', () => {
		expect(sync).toContain('metadataFields(metadataPayload.value)');
		expect(sync).toContain('localConv.hydrationIncomplete !== true &&');
		expect(sync).toContain('convUnavailablePayloads > 0 ? { hydrationIncomplete: true } : {}');
	});

	it('store messages under the conversation asked for', () => {
		expect(sync).toContain('const { conversationId } = item;');
		expect(sync).not.toMatch(/messages\[0\][^;]*conversationId/);
	});
});
