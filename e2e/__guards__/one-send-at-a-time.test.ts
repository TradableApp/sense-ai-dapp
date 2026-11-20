import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './source-scan';

/**
 * While a paid prompt is being sent, the chat tells the edit box and an answer's actions,
 * which then send nothing a second time. Nothing renders the chat in a unit test, so this
 * reads its source: dropping the flag from either leaves every other test green.
 */
const chat = stripComments(
	readFileSync(resolve(process.cwd(), 'src/features/chat/Chat.tsx'), 'utf8'),
);

/** The self-closing `<Tag … />` element that starts at the first `<Tag`, or ''. */
function element(source: string, tag: string): string {
	const start = source.search(new RegExp(`<${tag}\\b`));
	if (start === -1) return '';
	const end = source.indexOf('/>', start);
	return end === -1 ? '' : source.slice(start, end);
}

/** Whether `attribute` stands on a line of its own in `text`, so no condition is added to it. */
const hasLine = (text: string, attribute: string) =>
	new RegExp(`^[ \\t]*${attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm').test(text);

describe('the chat sends one paid prompt at a time', () => {
	it('takes its mutations and isSending through useOneSendAtATime', () => {
		expect(hasLine(chat, '} = useOneSendAtATime(useChatMutations());')).toBe(true);
		expect(hasLine(chat, 'isSending,')).toBe(true);
		expect(hasLine(chat, 'const isProcessing = isSubmitting || isSending;')).toBe(true);
	});

	it.each(['EditPromptInput', 'MessageActions'])('passes the flag to %s', tag => {
		expect(hasLine(element(chat, tag), 'isSending={isProcessing}')).toBe(true);
	});
});
