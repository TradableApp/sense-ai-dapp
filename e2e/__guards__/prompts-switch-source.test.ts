// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

/**
 * The prompts switch is read in one place. A second reader (another listener, a one-off
 * `getDoc`) could disagree with the first about what a cached or malformed answer means,
 * or start a second listener per page; a writer would be refused by the rules but should
 * not exist either. The banner shows only words that live in the app: nothing from the
 * document is ever rendered, and nothing is rendered as raw HTML.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const COLLECTION = 'senseai_prompts_switch';
const SOURCE = path.join('lib', 'promptsSwitchSource.ts');

const appFiles = sourceFiles(SRC, f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const code = (file: string) => stripComments(readFileSync(path.join(SRC, file), 'utf8'));
const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

describe('where the prompts switch is read', () => {
	it('the collection is named in one source file', () => {
		expect(appFiles.filter(f => code(f).includes(COLLECTION))).toEqual([SOURCE]);
	});

	it('that file listens once and writes nothing', () => {
		const source = code(SOURCE);
		expect(count(source, /\bonSnapshot\(/g)).toBe(1);
		expect(source).toContain('includeMetadataChanges: true');
		expect(source).not.toMatch(/\b(getDoc|getDocs|setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\b/);
	});

	it.each(['subscribePromptsSwitch', 'readPromptsSwitch'])(
		'the store is read only through the hook: %s',
		name => {
			const readers = appFiles.filter(f => new RegExp(`\\b${name}\\b`).test(code(f)));
			expect(readers.sort()).toEqual([SOURCE, path.join('hooks', 'usePromptsSwitch.ts')].sort());
		},
	);
});

describe('what the banner can show', () => {
	it.each([
		path.join('components', 'PaymentsSwitchedOffBanner.tsx'),
		path.join('lib', 'promptsSwitch.ts'),
		path.join('lib', 'paymentGate.ts'),
		SOURCE,
	])('%s renders no raw HTML', file => {
		expect(code(file)).not.toMatch(
			/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/,
		);
	});

	it('the banner words come from the gate, not from a document', () => {
		const banner = code(path.join('components', 'PaymentsSwitchedOffBanner.tsx'));
		// gateSections is gateCopy with the source of each notice, which the banner tones by.
		expect(banner).toMatch(/\bgateSections\(/);
		expect(banner).not.toMatch(/firebase|onSnapshot|\.data\(\)/);
	});
});
