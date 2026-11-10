// @vitest-environment node
//
// Every dApp hook that polls the subgraph spends the shared query quota for as long as a page is
// open. The Studio endpoint allows 3,000 queries a day; a 15 s poll in one hook is 240 queries an
// hour per open tab, and two run days exhausted the quota on 2026-11-10. Background polling of
// the Graph is a minute or slower; faster reactions come from the block-driven live poller.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

const SRC = path.join(E2E_DIR, '..', 'src');
const MIN_POLL_MS = 60_000;

describe('subgraph polling cadence', () => {
	const hooks = sourceFiles(SRC, f => /\.(ts|tsx|js|jsx)$/.test(f) && !/\.test\./.test(f))
		.map(f => path.join(SRC, f))
		.filter(f => readFileSync(f, 'utf8').includes('VITE_THE_GRAPH_API_URL'));

	it('finds the hooks that read the Graph URL', () => {
		expect(hooks.length).toBeGreaterThan(0);
	});

	it.each(hooks.map(f => [path.relative(SRC, f), f]))(
		'%s polls the subgraph no faster than once a minute',
		(_name, file) => {
			const source = stripComments(readFileSync(file, 'utf8'));
			// Accepts a literal or a product of literals (`60 * 1000`); anything else is a failure
			// so a clever expression cannot slip under the floor unread.
			for (const m of source.matchAll(/refetchInterval:\s*([^,\n]+)/g)) {
				const expr = m[1].trim();
				expect(expr, m[0]).toMatch(/^[\d_]+(\s*\*\s*[\d_]+)*$/);
				const value = expr.split('*').reduce((acc, n) => acc * Number(n.replace(/[\s_]/g, '')), 1);
				expect(value, m[0]).toBeGreaterThanOrEqual(MIN_POLL_MS);
			}
		},
	);
});
