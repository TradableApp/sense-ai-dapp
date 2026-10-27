// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Payload bytes are fetched through `src/lib/payloadStorage.ts` only.
 *
 * That module owns the source order (our GCS mirror first, then the Autonomys or Irys
 * gateway), the bounded retry with backoff, the typed unavailable result and the Sentry
 * breadcrumbs. A direct `fetch('https://gateway.autonomys.xyz/…')` anywhere else would
 * bypass all of that and bring back the single-attempt reads that left history empty for
 * the whole of a gateway outage. The host names are therefore forbidden outside the
 * resolver, in code and in string literals alike.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const ALLOWED = new Set([path.join(SRC, 'lib', 'payloadStorage.ts')]);

const FORBIDDEN = /gateway\.autonomys\.xyz|gateway\.irys\.xyz|storage\.googleapis\.com/;
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function listSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) return listSourceFiles(full);
		if (!/\.(ts|tsx|js|jsx)$/.test(name)) return [];
		if (/\.test\.(ts|tsx)$/.test(name)) return [];
		return [full];
	});
}

describe('no raw storage gateway URLs in src/', () => {
	it('names the payload hosts only inside the payload resolver', () => {
		const offenders = listSourceFiles(SRC).filter(file => {
			if (ALLOWED.has(file)) return false;
			return FORBIDDEN.test(stripComments(readFileSync(file, 'utf8')));
		});

		expect(offenders.map(f => path.relative(ROOT, f))).toEqual([]);
	});
});
