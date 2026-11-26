// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is pinned
// per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { offendersIn, sourceFiles, stripComments } from './source-scan';

/**
 * Rendered conversation text loads nothing and links nowhere unsafe.
 *
 * Prompts, answers (stored and provisional), live steps and sources are decrypted text. They are
 * rendered as markdown through one renderer, `MarkdownText` in `src/features/chat/markdown.tsx`,
 * which turns an image into its alt text, keeps raw HTML as text and makes a link only of an
 * http or https URL; every such link (and every source link) is a `SafeLink`
 * (`src/components/ai/safe-link.tsx`), the one element in the conversation code with an `href`.
 * The rich copy to the clipboard goes through the same markdown rule. Nothing in `src/` writes
 * HTML from a string, and the conversation code renders no element that loads a resource except
 * the app's own bundled images.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));

const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);
const ALL_SRC = sourceFiles(SRC, isSource).map(f => `src/${f}`);

const RENDERER = 'src/features/chat/markdown.tsx';
const SAFE_LINK = 'src/components/ai/safe-link.tsx';
const SAFE_MARKDOWN = 'src/lib/safeMarkdown.ts';
const CLIPBOARD = 'src/lib/utils.ts';

/** Where conversation text is rendered: the chat, the history, the reasoning and live answer. */
const CONVERSATION_DIRS = ['src/features/chat', 'src/features/history', 'src/components/ai'];
const CONVERSATION_FILES = ALL_SRC.filter(
	file => /\.tsx$/.test(file) && CONVERSATION_DIRS.some(dir => file.startsWith(`${dir}/`)),
);

const offending = (files: string[], pattern: RegExp) =>
	files.flatMap(file => offendersIn(file, read(file), pattern));

const importersOf = (pattern: RegExp) => ALL_SRC.filter(file => pattern.test(code(file)));

describe('conversation text renders inert', () => {
	it('covers the conversation code', () => {
		expect(CONVERSATION_FILES).toEqual(
			expect.arrayContaining([
				'src/features/chat/Chat.tsx',
				'src/features/chat/LiveAnswer.tsx',
				'src/features/history/History.tsx',
				'src/components/ai/reasoning.tsx',
				'src/components/ai/source.tsx',
				'src/components/ai/earlier-attempt.tsx',
				SAFE_LINK,
			]),
		);
	});

	it('renders markdown only through the shared renderer', () => {
		expect(importersOf(/from\s+['"]react-markdown['"]/)).toEqual([RENDERER]);
		expect(importersOf(/from\s+['"]remark-rehype['"]/)).toEqual([CLIPBOARD]);
		expect(
			importersOf(
				/from\s+['"](rehype-raw|harden-react-markdown|streamdown|marked|markdown-it|micromark|mdast-util-to-hast|hast-util-to-jsx-runtime|rehype-react)['"]/,
			),
		).toEqual([]);
	});

	it('makes the renderer and the clipboard copy apply the markdown rule', () => {
		const renderer = code(RENDERER);
		expect(renderer).toMatch(/remarkSafeContent/);
		expect(renderer).toMatch(/urlTransform=\{/);
		expect(renderer).toMatch(/allowedElements=\{/);
		expect(renderer).toMatch(/\bimg:\s*\w+/);
		expect(renderer).toMatch(/\ba:\s*\w+/);
		expect(renderer).not.toMatch(/rehypePlugins|skipHtml=\{false\}|allowDangerousHtml/);
		expect(code(CLIPBOARD)).toMatch(/\.use\(remarkSafeContent\)\s*\.use\(remarkRehype\)/);
		expect(code(CLIPBOARD)).not.toMatch(/allowDangerousHtml/);
		expect(code(SAFE_MARKDOWN)).toMatch(/safeHref\(/);
	});

	it('writes no HTML from a string anywhere in src/', () => {
		expect(
			offending(
				ALL_SRC,
				/dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/,
			),
		).toEqual([]);
	});

	it('renders no element that loads a resource in the conversation code, but bundled images', () => {
		const tags = /<(img|iframe|frame|audio|video|source|track|picture|object|embed|link|script|style|image|AvatarImage)\b/;
		const offenders = CONVERSATION_FILES.flatMap(file => {
			const lines = code(file).split('\n');
			return lines.flatMap((line, i) => {
				if (!tags.test(line)) return [];
				// The tag's own attributes, up to the end of the tag.
				const tag = lines.slice(i, i + 6).join(' ').split(/\/?>/)[0];
				const src = tag.match(/\bsrcS?e?t?=\{\s*([A-Za-z_$][\w$]*)\s*\}/)?.[1];
				const isBundled =
					src !== undefined &&
					new RegExp(`import\\s+${src}\\s+from\\s+['"]@/assets/`).test(code(file));
				// The avatar takes its image from its callers, which the next check holds to bundled ones.
				const isAvatarProp = file === 'src/components/ai/message.tsx' && src === 'src';
				return isBundled || isAvatarProp ? [] : [`${file}:${i + 1}`];
			});
		});

		expect(offenders).toEqual([]);
	});

	it('gives the message avatar only bundled images', () => {
		const offenders = ALL_SRC.flatMap(file => {
			const source = code(file);
			return [...source.matchAll(/<MessageAvatar\b[^>]*\bsrc=\{\s*([^}\s]+)\s*\}/g)]
				.filter(([, src]) => !new RegExp(`import\\s+${src}\\s+from\\s+['"]@/assets/`).test(source))
				.map(([match]) => `${file}: ${match}`);
		});

		expect(offenders).toEqual([]);
	});

	it('makes a link in the conversation code only through SafeLink', () => {
		const others = CONVERSATION_FILES.filter(file => file !== SAFE_LINK);

		expect(offending(others, /\bhref=|<a\b/)).toEqual([]);
		expect(code(SAFE_LINK)).toMatch(/safeHref\(/);
		expect(code(SAFE_LINK)).toMatch(/rel="noopener noreferrer nofollow"/);
		expect(code(SAFE_LINK)).toMatch(/referrerPolicy="no-referrer"/);
		expect(code(SAFE_LINK)).toMatch(/target="_blank"/);
		[RENDERER, 'src/components/ai/source.tsx', 'src/components/ai/earlier-attempt.tsx'].forEach(
			file => expect(code(file)).toMatch(/<SafeLink\b/),
		);
	});
});
