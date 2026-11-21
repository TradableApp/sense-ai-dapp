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
	...lock.matchAll(/startedAlone\(\s*(\w+),\s*isSendUnderWay,\s*untilFinished,\s*'[a-z]+',?\s*\)/g),
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

/**
 * The text of the call that starts at `start` (an opening parenthesis), brackets balanced.
 * A bracket inside a quoted string or a template is words, not code. Comments are stripped
 * before this reads; a regular expression holding a quote or a bracket is not understood.
 */
function callAt(source: string, start: number): string {
	let depth = 0;
	let quote = '';
	for (let i = start; i < source.length; i += 1) {
		const char = source[i];
		if (quote) {
			if (char === '\\') i += 1;
			else if (char === quote) quote = '';
		} else if ('\'"`'.includes(char)) {
			quote = char;
		} else {
			if ('([{'.includes(char)) depth += 1;
			if (')]}'.includes(char)) depth -= 1;
			if (depth === 0) return source.slice(start, i + 1);
		}
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
 * The chat's writes to the local store after a confirmed send. Each must be awaited (or
 * returned) inside its `onSuccess`, or the lock lets go before the prompt is saved.
 */
const SAVES = [
	'addMessageToConversation',
	'createNewConversation',
	'editUserMessage',
	'regenerateAssistantResponse',
	'branchConversation',
];

/** The body of an `async` arrow handler, or null when the handler is anything else. */
function asyncBody(text: string): string | null {
	const head = /^\w+:\s*async\s+(?:\([^)]*\)|\w+)\s*=>\s*/.exec(text);
	return head ? text.slice(head[0].length) : null;
}

/**
 * Why the handler does not give the chat's work back to the lock, or '' when it does. It
 * must be an `async` arrow (a promise of all it awaits), call at least one save, and await or
 * return every save it calls. Nothing in it may start work it does not wait for: an
 * `(async () => …)()` left running, `.then(`, `setTimeout`, `queueMicrotask` or the `void`
 * operator (the `void` type, after a colon or inside `<…>`, is not work).
 */
function whyNotHandedBack(text: string): string {
	const body = asyncBody(text);
	if (body === null) return 'not an async arrow';
	if (/(?<!await |return )\(async\b/.test(body))
		return 'starts an async function it does not await';
	const unwaited = /\.then\(|\bsetTimeout\(|\bqueueMicrotask\(|(?<![:<|]\s*)\bvoid\s+[\w(]/.exec(
		body,
	);
	if (unwaited) return `starts work it does not wait for (${unwaited[0]})`;
	const calls = [...body.matchAll(new RegExp(`\\b(${SAVES.join('|')})\\(`, 'g'))];
	if (calls.length === 0) return 'calls none of the saves';
	const bare = calls.find(call => !/\b(?:await|return)\s+$/.test(body.slice(0, call.index ?? 0)));
	return bare ? `${bare[1]} is neither awaited nor returned` : '';
}

describe("the guard's own reading of a handler", () => {
	it('does not count a bracket inside a string as code', () => {
		expect(callAt("(a, 'an open ( in words', `and [ here`, b) + (c)", 0)).toBe(
			"(a, 'an open ( in words', `and [ here`, b)",
		);
		expect(callAt("('it\\'s ( open', b).rest", 0)).toBe("('it\\'s ( open', b)");
	});

	it('reads void as unwaited work only where it is the operator', () => {
		const typed =
			'onSuccess: async () => { const done: Promise<void> = ready; const noop = (): void => undefined; await addMessageToConversation(x); }';
		const discarded = 'onSuccess: async () => { void addMessageToConversation(x); }';

		expect(whyNotHandedBack(typed)).toBe('');
		expect(whyNotHandedBack(discarded)).toMatch(/does not wait for \(void/);
	});
});

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
			expect(whyNotHandedBack(onSuccess), `${name}: ${onSuccess.slice(0, 80)}`).toBe('');
		});
	});

	// A prompt that was paid for but not saved on this device must not be sent again by
	// reflex: the lock tells the user, holds the conversation and asks for a sync, and each
	// prompt call clears its own input. The composer clears first, then shows the prompt from
	// its receipt and opens the cancel window, as its onSuccess does. The call is known by
	// what it saves.
	it.each([
		[
			'the composer',
			/\b(?:addMessageToConversation|createNewConversation)\(/,
			/^onSaveFailed:\s*newIds\s*=>\s*\{\s*reset\(\);\s*showUnsavedPrompt\(dispatch,[\s\S]*\bids: newIds,[\s\S]*\}\);\s*openCancelWindow\(\);\s*\},?$/,
		],
		[
			'the edit box',
			/\beditUserMessage\(/,
			/^onSaveFailed:\s*\(\)\s*=>\s*setEditingMessageId\(null\),?$/,
		],
	])('clears %s when its paid prompt could not be saved', (_input, saves, clears) => {
		const calls = sendCalls().filter(
			c => c.name === 'initiatePromptMutation' && saves.test(handler(c.call, 'onSuccess')),
		);
		expect(calls).toHaveLength(1);
		expect(handler(calls[0].call, 'onSaveFailed').trim()).toMatch(clears);
	});

	it.each(['EditPromptInput', 'MessageActions'])('passes the flag to %s', tag => {
		expect(hasLine(element(chat, tag), 'isSending={isProcessing}')).toBe(true);
	});
});
