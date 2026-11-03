// Shared scanner for the static guards: list the source files under an e2e directory and
// report the `file:line` of every line that matches a pattern, with comments removed first.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Recursive: readdirSync is shallow by default, so a file moved into a subdirectory would
// silently escape a guard while any minimum-count check kept passing on the top level.
export function sourceFiles(dir: string, matches: (_file: string) => boolean): string[] {
	return readdirSync(dir, { recursive: true }).filter(
		(f): f is string => typeof f === 'string' && matches(f),
	);
}

// Match code, not comments: a file explaining why it avoids a pattern must not fail on its own
// documentation. Block comments are replaced by their newlines so reported line numbers hold;
// a `//` not preceded by `:` (so a URL survives) drops the rest of its line.
// Known limitation: a `//` inside a string or template literal also drops the rest of that line,
// so a forbidden pattern after it in the same string is missed (a false negative, never a false
// positive). The guards accept that trade-off over a full tokenizer.
export function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function offendersIn(file: string, source: string, pattern: RegExp): string[] {
	return stripComments(source)
		.split('\n')
		.flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}`] : []));
}

/** `<dir basename>/<file>:<line>` for every match of `pattern` in the files `matches` selects. */
export function offenders(
	dir: string,
	matches: (_file: string) => boolean,
	pattern: RegExp,
): string[] {
	const label = path.basename(dir);
	return sourceFiles(dir, matches).flatMap(file =>
		offendersIn(`${label}/${file}`, readFileSync(path.join(dir, file), 'utf8'), pattern),
	);
}
