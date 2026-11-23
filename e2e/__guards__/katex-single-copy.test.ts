// @vitest-environment node
//
// Static guard over package.json and bun.lock (pure Node; see the adr-0002 guard for why the
// environment is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * One copy of katex, so the markup matches the stylesheet.
 *
 * The app imports katex's stylesheet from its own katex dependency, while rehype-katex and
 * micromark-extension-math (whose latest releases still ask for katex ^0.16) render the markup.
 * katex 0.18 prefixes its CSS classes, so a nested 0.16 copy would render markup the 0.18
 * stylesheet no longer matches. The `overrides` entry in package.json makes them share the one
 * copy; it is not stale while those packages ask for ^0.16, and removing it fails here.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	dependencies: Record<string, string>;
	overrides?: Record<string, string>;
};
const lock = readFileSync(path.join(ROOT, 'bun.lock'), 'utf8');

describe('katex', () => {
	it('is overridden to the version the app depends on', () => {
		expect(pkg.dependencies.katex).toBeDefined();
		expect(pkg.overrides?.katex).toBe(pkg.dependencies.katex);
	});

	it('resolves to one copy in the lockfile', () => {
		const copies = lock.match(/\["katex@[^"]+"/g) ?? [];
		expect(copies).toHaveLength(1);
	});
});
