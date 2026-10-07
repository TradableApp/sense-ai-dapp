import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			// CLAUDE.md forbids relative imports that traverse directories, and `@/` stops at src/.
			// abi-sync.test.ts needs scripts/abi-fingerprint.mjs — the same implementation the sync
			// script runs — so scripts/ gets an alias of its own rather than a ../../../ escape.
			'#scripts': path.resolve(__dirname, './scripts'),
		},
	},
	test: {
		// Playwright owns e2e/**/*.spec.ts; vitest owns src/ plus e2e/**/*.test.ts, which is
		// only the ADR-0002 guard (static analysis of the spec files — no browser, no stack).
		// The `.test.ts` suffix is what keeps the two runners disjoint: adding e2e/ here does
		// NOT collect Playwright specs, because those are all `.spec.ts`.
		include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.test.ts'],
		environment: 'happy-dom',
	},
});
