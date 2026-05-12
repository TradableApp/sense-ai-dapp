import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { '@': path.resolve(__dirname, './src') },
	},
	test: {
		// Explicitly scope vitest to src/ — Playwright runs e2e/ with its own runner.
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		environment: 'happy-dom',
	},
});
