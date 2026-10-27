// @vitest-environment node
//
// Static guard over vite.config.ts (pure Node; see the adr-0002 guard for why the
// environment is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The service worker must never reload a healthy page on its own (sense-ai-dapp#81).
 *
 * `registerType: 'autoUpdate'` makes the generated register script reload the page as soon
 * as a new worker takes control — on the first load after every deploy, for every client.
 * A reload in the middle of a wallet signature aborts the request and bounces the user to
 * /auth. The app runs in `prompt` mode instead and `src/components/UpdatePrompt.tsx` offers
 * the reload, deferring it while a wallet flow is in flight. Flipping the config back would
 * silently reintroduce the bug, so the setting is pinned here.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viteConfig = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');

describe('service worker registration mode', () => {
	it('registers the PWA service worker in prompt mode', () => {
		expect(viteConfig).toMatch(/registerType:\s*['"]prompt['"]/);
	});

	it('never uses autoUpdate, which reloads the page under the user', () => {
		expect(viteConfig).not.toMatch(/autoUpdate/);
	});
});
