import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { offenders, stripComments } from './source-scan';

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
const wrapped = [
	...lock.matchAll(/startedAlone\(\s*(\w+),\s*isSendUnderWay,\s*untilFinished,?\s*\)/g),
].map(match => match[1]);

/**
 * The self-closing `<Tag … />` element that starts at the first `<Tag`, or ''. It ends at the
 * first `/>`, so a prop holding a self-closing element ahead of the flag cuts it short and the
 * guard fails with the flag in place: move the flag above that prop.
 */
function element(source: string, tag: string): string {
	const start = source.search(new RegExp(`<${tag}\\b`));
	if (start === -1) return '';
	const end = source.indexOf('/>', start);
	return end === -1 ? '' : source.slice(start, end);
}

/** Whether `attribute` stands on a line of its own in `text`, so no condition is added to it. */
const hasLine = (text: string, attribute: string) =>
	new RegExp(`^[ \\t]*${attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm').test(text);

/** The text of the call that starts at `start` (an opening parenthesis), brackets balanced. */
function callAt(source: string, start: number): string {
	let depth = 0;
	for (let i = start; i < source.length; i += 1) {
		if ('([{'.includes(source[i])) depth += 1;
		if (')]}'.includes(source[i])) depth -= 1;
		if (depth === 0) return source.slice(start, i + 1);
	}
	return source.slice(start);
}

/** Every `<name>.mutate(…)` call in the chat for the wrapped mutations, with its name. */
const sendCalls = () =>
	wrapped.flatMap(name =>
		[...chat.matchAll(new RegExp(`\\b${name}\\.mutate\\(`, 'g'))].map(match => ({
			name,
			call: callAt(chat, (match.index ?? 0) + match[0].length - 1),
		})),
	);

/**
 * The handler `property` in `call`: from its name to the end of the arrow function's body
 * (the balanced block, or the rest of the line for an expression body), or ''.
 */
function handler(call: string, property: string): string {
	const start = call.search(new RegExp(`\\b${property}:`));
	if (start === -1) return '';
	const arrow = call.indexOf('=>', start);
	if (arrow === -1) return call.slice(start);
	const bodyStart = call.slice(arrow + 2).search(/\S/) + arrow + 2;
	return call[bodyStart] === '{'
		? call.slice(start, bodyStart) + callAt(call, bodyStart)
		: call.slice(start, call.indexOf('\n', bodyStart));
}

/**
 * Whether the handler gives its work back. An `async` arrow gives back a promise of all it
 * awaits; an arrow whose body is an expression gives that back; a block body that is not
 * `async` gives back nothing unless it starts with `return`. Work started inside and neither
 * awaited nor returned (an `(async () => …)()` left running) is not counted by the lock, so
 * it fails either way. Anything else (a named function passed in) fails: it cannot be read.
 */
function handsWorkBack(text: string): boolean {
	const head = /^\w+:\s*(async\s+)?(?:\([^)]*\)|\w+)\s*=>\s*/.exec(text);
	if (!head) return false;
	const body = text.slice(head[0].length);
	if (/(?<!await |return )\(async\b/.test(body)) return false;
	if (head[1]) return true;
	return !body.startsWith('{') || /^\{\s*return\b/.test(body);
}

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

	// Anything else that started one of them would start it around the lock.
	it('names the wrapped mutations nowhere but where they are made, wrapped and used', () => {
		const allowed = [
			'hooks/useChatMutations.tsx',
			'features/chat/useOneSendAtATime.ts',
			'features/chat/Chat.tsx',
		];
		const isOtherSource = (file: string) =>
			/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !allowed.includes(file);

		expect(wrapped).toHaveLength(3);
		expect(
			offenders(resolve(process.cwd(), 'src'), isOtherSource, new RegExp(wrapped.join('|'))),
		).toEqual([]);
	});

	// The lock counts the chat's work after a confirmed send only if onSuccess gives it back.
	// A handler that starts it and returns nothing releases the lock before the prompt is
	// saved, and a press in between pays for the same prompt again.
	it('starts four sends, and each onSuccess gives its work back to the lock', () => {
		const calls = sendCalls();
		expect(calls.map(c => c.name).sort()).toEqual(
			[
				'branchConversationMutation',
				'initiatePromptMutation',
				'initiatePromptMutation',
				'regenerateMutation',
			].sort(),
		);
		calls.forEach(({ name, call }) => {
			const onSuccess = handler(call, 'onSuccess');
			expect(onSuccess, name).not.toBe('');
			expect(handsWorkBack(onSuccess), `${name}: ${onSuccess.slice(0, 80)}`).toBe(true);
		});
	});

	// A prompt that was paid for but not saved on this device must not be sent again by
	// reflex: the lock tells the user and asks for a sync, and the chat clears what it shows.
	it('clears the composer and the edit box when a paid prompt could not be saved', () => {
		const clears = sendCalls()
			.filter(c => c.name === 'initiatePromptMutation')
			.map(c => handler(c.call, 'onSaveFailed'));
		expect(clears.some(text => /\breset\(\)/.test(text))).toBe(true);
		expect(clears.some(text => /\bsetEditingMessageId\(null\)/.test(text))).toBe(true);
	});

	it.each(['EditPromptInput', 'MessageActions'])('passes the flag to %s', tag => {
		expect(hasLine(element(chat, tag), 'isSending={isProcessing}')).toBe(true);
	});
});
