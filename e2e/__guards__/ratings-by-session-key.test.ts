// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offendersIn, sourceFiles, stripComments } from './source-scan';

/**
 * Answer ratings are stored under an id only the session key holder can compute, and are read
 * back one document at a time by that id. The collection is named in one module, which only
 * gets a document by id: no list, no query, no listener and no write (the callable writes).
 * The id is computed in two places (the send and the read) and never reaches a log line or an
 * error report; the send carries no wallet address and no conversation, message or parent id.
 */
const SRC = path.resolve(E2E_DIR, '..', 'src');
const COLLECTION = 'senseai_feedback';
const RATING = path.join('lib', 'answerRating.ts');
const SERVICE = path.join('lib', 'feedbackService.ts');
const HOOK = path.join('features', 'chat', 'useAnswerRatings.ts');

const appFiles = sourceFiles(SRC, f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const raw = (file: string) => readFileSync(path.join(SRC, file), 'utf8');
const code = (file: string) => stripComments(raw(file));

describe('where answer ratings are read', () => {
	it('the collection is named in one source file', () => {
		expect(appFiles.filter(f => code(f).includes(COLLECTION))).toEqual([RATING]);
	});

	it('that file gets one document by id and never lists, queries, listens or writes', () => {
		const source = code(RATING);
		expect(source).toMatch(/\bgetDoc\(/);
		expect(source).not.toMatch(
			/\b(getDocs|query|where|collection|collectionGroup|onSnapshot|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\b/,
		);
	});

	it('the rating id is computed only by the send and the read', () => {
		const callers = appFiles.filter(f => /\bratingDocId\(/.test(code(f)) && f !== RATING);
		expect(callers.sort()).toEqual([SERVICE, HOOK].sort());
	});

	it('the send names no wallet address and no conversation, message or parent id in what it sends', () => {
		const source = code(SERVICE);
		expect(source).not.toMatch(/\bownerAddress\b|\bparentId\b/);
		expect(source).toMatch(/\{\s*docId,\s*feedbackValue,\s*chainId,\s*agentAddress\s*\}/);
	});

	it.each([RATING, SERVICE, HOOK])('%s passes no rating id to a log line or a report', file => {
		const reporting = /\b(console\.\w+|Sentry\.\w+|captureException|captureMessage|toast\.\w+)\s*\(/;
		const lines = code(file).split('\n');
		const offenders = offendersIn(file, raw(file), reporting).filter(at => {
			const line = lines[Number(at.split(':').at(-1)) - 1];
			return /\bdocId\b|\bratingId\b/.test(line);
		});
		expect(offenders).toEqual([]);
	});
});
