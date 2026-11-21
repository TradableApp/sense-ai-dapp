// @vitest-environment node
//
// Static guard over the e2e page objects, helpers, fixtures and specs: an answer bubble is
// located only through STORED_ANSWER in pages/ChatPage.ts. With the live reasoning stream on,
// the provisional answer is an `.is-assistant` bubble too; a raw `.is-assistant` locator counts
// it, so a wait meant for the stored answer could end on the provisional one and race whatever
// the test does next. STORED_ANSWER matches `data-answer-state="stored"` only.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offenders, offendersIn } from './source-scan';

const RAW_BUBBLE = /\.is-assistant\b/;
const DEFINITION = 'pages/ChatPage.ts';
const STORED_DEFINITION =
	/^export const STORED_ANSWER = '\.is-assistant\[data-answer-state="stored"\]';$/;

const isSource = (file: string) => /\.tsx?$/.test(file) && !file.startsWith('__guards__');

describe('answer bubbles are located as stored answers only', () => {
	it('matches code, not comments', () => {
		const source = "// '.is-assistant' explained\nconst x = page.locator('.is-assistant');";
		expect(offendersIn('x.ts', source, RAW_BUBBLE)).toEqual(['x.ts:2']);
	});

	it('STORED_ANSWER requires the stored state, and is the only raw .is-assistant selector', () => {
		const lines = readFileSync(path.join(E2E_DIR, DEFINITION), 'utf8').split('\n');
		const definitionLine = lines.findIndex(line => STORED_DEFINITION.test(line)) + 1;
		expect(definitionLine, `${DEFINITION} defines STORED_ANSWER as stored only`).toBeGreaterThan(0);

		const found = offenders(E2E_DIR, isSource, RAW_BUBBLE);
		expect(
			found,
			'Use ChatPage.assistantMessages / latestAiMessage (STORED_ANSWER), never a raw .is-assistant locator',
		).toEqual([`${path.basename(E2E_DIR)}/${DEFINITION}:${definitionLine}`]);
	});
});
