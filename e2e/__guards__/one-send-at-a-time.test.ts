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

const read = (path: string) => stripComments(readFileSync(resolve(process.cwd(), path), 'utf8'));
const lock = read('src/features/chat/useOneSendAtATime.ts');
const mutations = read('src/hooks/useChatMutations.tsx');

/** The mutations the lock wraps, by the name they have in `useChatMutations`. */
const wrapped = [...lock.matchAll(/startedAlone\((\w+), isSendUnderWay\)/g)].map(match => match[1]);

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

	// The lock counts mutations by the start of their key. A wrapped mutation with no such key
	// is refused by nothing and never shows as sending.
	it('wraps three mutations, and each is declared with the key the lock counts', () => {
		expect(wrapped).toHaveLength(3);
		wrapped.forEach(name => {
			const declared = new RegExp(
				`const ${name} = useMutation\\(\\{\\s*mutationKey: \\['paid-send', '[a-z]+'\\],`,
			);
			expect(declared.test(mutations), name).toBe(true);
		});
	});

	it('gives that key to no other mutation', () => {
		expect(mutations.match(/\['paid-send'/g) ?? []).toHaveLength(wrapped.length);
		expect(lock).toContain("export const PAID_SEND_KEY = ['paid-send'];");
	});

	it.each(['EditPromptInput', 'MessageActions'])('passes the flag to %s', tag => {
		expect(hasLine(element(chat, tag), 'isSending={isProcessing}')).toBe(true);
	});
});
