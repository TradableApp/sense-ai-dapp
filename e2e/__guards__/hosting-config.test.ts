// @vitest-environment node
//
// Static guard over firebase.json (pure Node; see adr-0002 guard for why the environment
// is pinned per file).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stripComments } from './source-scan';

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

/** The directives of a policy, by name, each with its sources in order. */
function directives(policy: string | undefined): Map<string, string[]> {
	return new Map(
		(policy ?? '')
			.split(';')
			.map(part => part.trim().split(/\s+/))
			.filter(([name]) => !!name)
			.map(([name, ...sources]) => [name.toLowerCase(), sources]),
	);
}

const headerOnEveryPath = (key: string) =>
	hosting.headers
		.find(rule => rule.source === '**')
		?.headers.find(h => h.key.toLowerCase() === key.toLowerCase())?.value;

const TELEGRAM_FRAME_ANCESTORS = [
	"'self'",
	'https://web.telegram.org',
	'https://*.telegram-apps.com',
];

describe('the Content-Security-Policy that is enforced', () => {
	const enforced = directives(headerOnEveryPath('Content-Security-Policy'));

	// Directives that cannot break the app: it uses no plugin content, no <base> and no form
	// that submits anywhere (each form's submit is handled in script).
	it.each([
		['object-src', ["'none'"]],
		['base-uri', ["'self'"]],
		['form-action', ["'self'"]],
	])('sets %s', (name, sources) => {
		expect(enforced.get(name)).toEqual(sources);
	});

	// The Telegram Mini App frames the dApp from these origins.
	it('keeps frame-ancestors as it was', () => {
		expect(enforced.get('frame-ancestors')).toEqual(TELEGRAM_FRAME_ANCESTORS);
	});

	// Anything more is tried in the report-only policy first: a wrong source there is a
	// console line, here it is a broken page.
	it('enforces nothing else', () => {
		expect([...enforced.keys()].sort()).toEqual(
			['base-uri', 'form-action', 'frame-ancestors', 'object-src'].sort(),
		);
	});
});

describe('the Content-Security-Policy that is only reported', () => {
	const reported = directives(headerOnEveryPath('Content-Security-Policy-Report-Only'));

	it('is set on every path', () => {
		expect(reported.size).toBeGreaterThan(0);
	});

	it("starts from the page's own origin", () => {
		expect(reported.get('default-src')).toEqual(["'self'"]);
	});

	// Every directive the enforced policy has, the same, so the report-only one is the whole
	// policy that would be enforced next.
	it('carries the enforced directives unchanged', () => {
		const enforced = directives(headerOnEveryPath('Content-Security-Policy'));
		enforced.forEach((sources, name) => expect(reported.get(name)).toEqual(sources));
	});

	it('allows no script from anywhere but listed origins and the one inline script', () => {
		const sources = reported.get('script-src') ?? [];
		expect(sources).toContain("'self'");
		expect(sources).not.toContain("'unsafe-inline'");
		expect(sources).not.toContain("'unsafe-eval'");
		expect(sources.some(source => /^https?:$|^\*$|^https:\/\/\*$/.test(source))).toBe(false);
	});

	it('allows no image from any https origin', () => {
		expect(reported.get('img-src') ?? []).not.toContain('https:');
	});

	// The repository has no setting for a reporting endpoint; reports go to the console.
	it('names no report endpoint', () => {
		expect(reported.has('report-uri')).toBe(false);
		expect(reported.has('report-to')).toBe(false);
	});
});

describe('what the enforced directives rely on', () => {
	const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

	it('has no <base>, <object> or <embed> in index.html', () => {
		expect(indexHtml).not.toMatch(/<(base|object|embed)\b/i);
	});

	// Every form in the app submits in script: none posts to an address of its own.
	it('has no form in src/ that submits to an address, and no <base>, <object> or <embed>', () => {
		const src = path.join(ROOT, 'src');
		// An element with an attribute: `<object>` alone is also a type argument.
		const found = sourceFiles(
			src,
			file => /\.(tsx|jsx)$/.test(file) && !/\.test\.(tsx|jsx)$/.test(file),
		).filter(file =>
			/<form\b[^>]*\baction=|\bformAction=|<(base|object|embed)\s+[a-zA-Z]/.test(
				stripComments(readFileSync(path.join(src, file), 'utf8')),
			),
		);
		expect(found).toEqual([]);
	});

	// The inline script the report-only policy allows by its hash.
	it('has the one inline script whose hash the report-only policy names', () => {
		const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
		expect(inline).toHaveLength(1);
		const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`;
		const reported = directives(headerOnEveryPath('Content-Security-Policy-Report-Only'));
		expect(reported.get('script-src')).toContain(hash);
	});
});
