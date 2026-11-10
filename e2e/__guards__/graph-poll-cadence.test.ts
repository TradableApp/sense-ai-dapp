// @vitest-environment node
//
// Every dApp hook that polls the subgraph spends the shared query quota for as long as a page is
// open. The Studio endpoint allows 3,000 queries a day; a 15 s poll in one hook is 240 queries an
// hour per open tab, and two run days exhausted the quota on 2026-11-10. Background polling of
// the Graph is a minute or slower; faster reactions come from the block-driven live poller.
//
// The scan covers EVERY `refetchInterval` under src/, not only files that name the Graph URL:
// a hook that imports the URL from a shared config module would otherwise escape the guard, and
// the non-Graph pollers (token price, RPC reads) are already at a minute or slower.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

const SRC = path.join(E2E_DIR, '..', 'src');
const MIN_POLL_MS = 60_000;

describe('subgraph polling cadence', () => {
	const hooks = sourceFiles(SRC, f => /\.(ts|tsx|js|jsx)$/.test(f) && !/\.test\./.test(f))
		.map(f => path.join(SRC, f))
		.filter(f => /refetchInterval/.test(stripComments(readFileSync(f, 'utf8'))));

	it('finds the hooks that poll', () => {
		expect(hooks.length).toBeGreaterThan(0);
		// The hook that exhausted the quota on 2026-11-10 must be among them.
		expect(hooks.map(f => path.relative(SRC, f))).toContain('hooks/useStuckRequests.ts');
	});

	it.each(hooks.map(f => [path.relative(SRC, f), f]))(
		'%s polls no faster than once a minute',
		(_name, file) => {
			const source = stripComments(readFileSync(file, 'utf8'));
			// Accepts a literal or a product of literals (`60 * 1000`); anything else is a failure
			// so a clever expression cannot slip under the floor unread.
			[...source.matchAll(/refetchInterval:\s*([^,\n]+)/g)].forEach(m => {
				const expr = m[1].trim();
				// `false` / `undefined` switch polling off entirely — no quota concern. A conditional
				// (`enabled ? 60_000 : false`) still has to satisfy the floor on its polling arm.
				if (expr === 'false' || expr === 'undefined') return;
				const polling = expr.includes('?') ? expr.split('?')[1].split(':')[0].trim() : expr;
				expect(polling, m[0]).toMatch(/^[\d_]+(\s*\*\s*[\d_]+)*$/);
				const value = polling
					.split('*')
					.reduce((acc, n) => acc * Number(n.replace(/[\s_]/g, '')), 1);
				expect(value, m[0]).toBeGreaterThanOrEqual(MIN_POLL_MS);
			});
		},
	);
});
