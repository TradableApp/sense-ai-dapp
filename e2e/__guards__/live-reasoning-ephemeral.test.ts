// @vitest-environment node
//
// The live reasoning overlay is memory only. What the stream shows is never written where the
// stored record lives (IndexedDB, Redux, the query cache) or to browser storage, so the stored
// answer stays the only record and nothing live outlives the page. The transport is started
// from one place, the setting is read in one place, and the proof of key never reaches a log,
// a report or a URL. The old socket path that appended live steps to Redux is gone for good.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { offendersIn, sourceFiles, stripComments } from './source-scan';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

const LIVE_DIR = 'src/lib/liveReasoning';
const HOOK = 'src/hooks/useLiveReasoning.ts';
const LIVE_FILES = [
	...sourceFiles(path.join(ROOT, LIVE_DIR), f => isSource(f) && !f.endsWith('.testdata.ts')).map(
		f => `${LIVE_DIR}/${f}`,
	),
	HOOK,
];

const ALL_SRC = sourceFiles(SRC, isSource).map(f => `src/${f}`);

function offending(files: string[], pattern: RegExp): string[] {
	return files.flatMap(file => offendersIn(file, read(file), pattern));
}

describe('live reasoning is an overlay in memory only', () => {
	it('covers the live modules', () => {
		expect(LIVE_FILES).toEqual(
			expect.arrayContaining([
				`${LIVE_DIR}/contract.ts`,
				`${LIVE_DIR}/frameTransport.ts`,
				`${LIVE_DIR}/liveAnswerSession.ts`,
				`${LIVE_DIR}/liveReducer.ts`,
				`${LIVE_DIR}/liveStore.ts`,
				`${LIVE_DIR}/reconcile.ts`,
				`${LIVE_DIR}/streamProof.ts`,
				HOOK,
			]),
		);
	});

	it('imports nothing that stores messages: the local database, the data service, the cache writer, Redux or the query cache', () => {
		const imports =
			/from\s+['"](@\/lib\/db|@\/lib\/dataService|@\/lib\/messageCacheStore|@\/store\b[^'"]*|dexie|@tanstack\/react-query|@\/lib\/browserStorage)['"]/;

		expect(offending(LIVE_FILES, imports)).toEqual([]);
	});

	it('touches no browser storage, dispatches nothing and writes no query data', () => {
		const writes =
			/\b(localStorage|sessionStorage|indexedDB|dispatch\s*\(|useAppDispatch|setQueryData|queryClient|document\.cookie|caches\.)/;

		expect(offending(LIVE_FILES, writes)).toEqual([]);
	});

	it('starts the transport only from useLiveReasoning', () => {
		const valueImport =
			/^import\s+(?!type\b)[^;]*from\s+['"][^'"]*liveReasoning\/frameTransport['"]/m;
		const importers = ALL_SRC.filter(
			file => !file.endsWith('frameTransport.ts') && valueImport.test(stripComments(read(file))),
		);

		expect(importers).toEqual([HOOK]);
	});

	it('reads the stream setting only in config/reasoningStream.ts', () => {
		const readers = ALL_SRC.filter(file =>
			/import\.meta\.env\.VITE_REASONING_STREAM_(URL|MODE)/.test(stripComments(read(file))),
		);
		const namers = ALL_SRC.filter(file =>
			/VITE_REASONING_STREAM_URL/.test(stripComments(read(file))),
		);

		expect(readers).toEqual(['src/config/reasoningStream.ts']);
		expect(namers.sort()).toEqual([
			'src/config/reasoningStream.ts',
			'src/config/reasoningStreamConfig.ts',
			'src/vite-env.d.ts',
		]);
	});

	it('checks the stream setting in vite.config.ts', () => {
		expect(stripComments(read('vite.config.ts'))).toMatch(
			/assertReasoningStreamConfig\(mode, env\);/,
		);
	});

	it('never puts the proof of key in a log line, a report or a URL', () => {
		const leaks = /\bproof\b[^\n]*(console\.|Sentry|captureException|addBreadcrumb|streamUrl\(|`)/i;
		const leaksReversed =
			/(console\.|Sentry|captureException|addBreadcrumb|streamUrl\()[^\n]*\bproof\b/i;

		expect(offending(LIVE_FILES, leaks)).toEqual([]);
		expect(offending(LIVE_FILES, leaksReversed)).toEqual([]);
		expect(read(`${LIVE_DIR}/frameTransport.ts`)).toMatch(
			/\[STREAM_HTTP\.proofHeader\]: options\.proof/,
		);
	});

	it('renders nothing live as raw HTML', () => {
		const files = [
			'src/features/chat/LiveAnswer.tsx',
			'src/components/ai/earlier-attempt.tsx',
			'src/components/ai/reasoning.tsx',
		];

		expect(offending(files, /dangerouslySetInnerHTML|innerHTML/)).toEqual([]);
	});

	it('turns a source URL into a link only through SafeLink, which applies safeHref', () => {
		const files = ['src/components/ai/source.tsx', 'src/components/ai/earlier-attempt.tsx'];

		// Passing the URL to `Source` or `SafeLink` is fine: they apply safeHref themselves.
		const rawLinks = ALL_SRC.flatMap(file => {
			const lines = stripComments(read(file)).split('\n');
			return lines.flatMap((line, i) =>
				/href=\{\s*source\.url\s*\}/.test(line) &&
				!/<(Source|SafeLink)\b/.test(lines.slice(Math.max(0, i - 3), i).join('\n'))
					? [`${file}:${i + 1}`]
					: [],
			);
		});

		expect(rawLinks).toEqual([]);
		files.forEach(file => expect(stripComments(read(file))).toMatch(/<SafeLink\b/));
		expect(stripComments(read('src/components/ai/safe-link.tsx'))).toMatch(/safeHref\(/);
	});

	it('has no second live path: the socket service, its mock and the Redux live reducers are gone', () => {
		expect(existsSync(path.join(ROOT, 'src/lib/webSocketService.ts'))).toBe(false);
		expect(existsSync(path.join(ROOT, 'src/lib/mockApi.ts'))).toBe(false);
		expect(existsSync(path.join(ROOT, 'src/lib/mockData.ts'))).toBe(false);
		expect(offending(ALL_SRC, /addReasoningStepById|updateMessageContentById/)).toEqual([]);
	});
});
