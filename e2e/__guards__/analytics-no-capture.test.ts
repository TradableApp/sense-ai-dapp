// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is pinned
// per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stripComments } from './source-scan';

/**
 * Analytics never records conversation text.
 *
 * Every container that shows conversation text (the chat, its composer and edit box, the
 * rendered markdown, the reasoning and live answer, the history list and the rename dialog)
 * carries the analytics SDK's `ph-no-capture` class, so autocapture records nothing inside it
 * and session replay, if it is ever turned on, blocks it whole (`blockClass` in
 * `src/config/posthog.ts`). A component that renders a conversation field itself carries the
 * class too, so a new one cannot be added outside a marked container by accident.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

const NO_CAPTURE = /className=(?:"[^"]*|\{[^}]*['"`][^'"`]*)\bph-no-capture\b/;

const CONTAINERS = [
	'src/features/chat/Chat.tsx',
	'src/features/chat/markdown.tsx',
	'src/features/chat/LiveAnswer.tsx',
	'src/components/ai/conversation.tsx',
	'src/components/ai/prompt-input.tsx',
	'src/components/ai/edit-prompt-input.tsx',
	'src/components/ai/reasoning.tsx',
	'src/components/ai/earlier-attempt.tsx',
	'src/features/history/History.tsx',
	'src/features/history/RenameConversationModal.tsx',
];

/** Where conversation text is rendered: the chat, the history, the reasoning and live answer. */
const CONVERSATION_DIRS = ['src/features/chat', 'src/features/history', 'src/components/ai'];
const TSX = sourceFiles(SRC, f => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
	.map(f => `src/${f}`)
	.filter(file => CONVERSATION_DIRS.some(dir => file.startsWith(`${dir}/`)));

/** A conversation field rendered as JSX text: a message's content, a title, a step, a preview. */
const RENDERS_CONVERSATION_FIELD =
	/(?<!=)>\s*\{[^{}]*\b(?:message|item|conversation|originalConversation|step|source|live)\??\.(?:content|title|description|lastMessagePreview|text|answer)\b/;

describe('analytics never records conversation text', () => {
	it('blocks the no-capture class in session replay', () => {
		const config = code('src/config/posthog.ts');
		expect(config).toMatch(/blockClass:\s*'ph-no-capture'/);
		expect(config).toMatch(/maskTextSelector:\s*'\*'/);
	});

	// The class counts wherever it stands in the attribute, not only in its first string.
	it.each([
		'className="ph-no-capture flex"',
		"className={cn('ph-no-capture flex', className)}",
		"className={cn('flex', 'ph-no-capture')}",
		"className={cn('flex', wide && 'w-full', `ph-no-capture`)}",
	])('reads the class in %s', attribute => {
		expect(attribute).toMatch(NO_CAPTURE);
	});

	it.each(['className="flex"', "className={cn('flex')} title='ph-no-capture'"])(
		'reads no class in %s',
		attribute => {
			expect(attribute).not.toMatch(NO_CAPTURE);
		},
	);

	it.each(CONTAINERS)('%s carries the no-capture class', file => {
		expect(code(file)).toMatch(NO_CAPTURE);
	});

	it('marks every component that renders a conversation field', () => {
		const unmarked = TSX.filter(
			file =>
				RENDERS_CONVERSATION_FIELD.test(code(file).replace(/\n\s*/g, ' ')) &&
				!NO_CAPTURE.test(code(file)),
		);

		expect(unmarked).toEqual([]);
	});

	it('marks the rename dialog itself, which renders outside the history list', () => {
		expect(code('src/features/history/RenameConversationModal.tsx')).toMatch(
			/<DialogContent\s+className=\{?["'`][^"'`]*\bph-no-capture\b/,
		);
	});
});
