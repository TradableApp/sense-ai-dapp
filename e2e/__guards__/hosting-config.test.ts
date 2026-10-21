// @vitest-environment node
//
// Static guard over firebase.json (pure Node; see adr-0002 guard for why the environment
// is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Hosting rules that keep a deploy from crashing tabs opened on the previous build
 * (sense-ai-dapp#75). Three rules, each load-bearing:
 *
 * 1. The SPA rewrite must NOT cover `/assets/**`. Hashed chunks either exist or must 404;
 *    a catch-all that answers a vanished chunk with index.html (200, text/html) makes the
 *    dynamic import fail with HTML parsed as a module.
 * 2. HTML (and the service-worker scripts) must be served `no-cache` so the browser
 *    revalidates on every navigation. Vite's own build guide requires this for the
 *    chunk-hash scheme to be safe across deploys.
 * 3. Hashed assets are immutable, so they may be cached for a year — correctness aside,
 *    this is the performance half of the same contract.
 *
 * firebase.json is data, not code, so nothing else in the repo would catch a well-meaning
 * "simplify the rewrites" edit that quietly restores the crash.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface HeaderRule {
	source?: string;
	regex?: string;
	headers: { key: string; value: string }[];
}
interface Hosting {
	rewrites: { source?: string; regex?: string; destination?: string }[];
	headers: HeaderRule[];
}

const { hosting } = JSON.parse(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')) as {
	hosting: Hosting;
};

const ASSETS_GLOB = '/assets/**';
const NOT_ASSETS_GLOB = '!/assets/**';
const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

const cacheControlFor = (source: string) =>
	hosting.headers
		.filter(rule => rule.source === source)
		.flatMap(rule => rule.headers)
		.find(h => h.key.toLowerCase() === 'cache-control')?.value;

describe('firebase.json hosting rules (sense-ai-dapp#75)', () => {
	it('rewrites everything except /assets/** to index.html, so a missing chunk is a 404', () => {
		const spa = hosting.rewrites.filter(r => r.destination === '/index.html');

		expect(spa).toHaveLength(1);
		expect(spa[0].source).toBe(NOT_ASSETS_GLOB);
	});

	it('serves HTML and service-worker files with Cache-Control: no-cache', () => {
		expect(cacheControlFor(NOT_ASSETS_GLOB)).toBe(NO_CACHE);
	});

	it('serves hashed assets as immutable for a year', () => {
		expect(cacheControlFor(ASSETS_GLOB)).toBe(IMMUTABLE);
	});

	it('keeps the security headers on every path', () => {
		const all = hosting.headers.find(rule => rule.source === '**');
		const keys = (all?.headers ?? []).map(h => h.key);

		expect(keys).toEqual(
			expect.arrayContaining(['X-Content-Type-Options', 'Strict-Transport-Security']),
		);
	});
});
