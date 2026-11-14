import { describe, expect, it } from 'vitest';

import inheritedHistory, { reachesFirstMessage } from './inheritedHistory';
import type { Message } from './types';

const msg = (id: string, parentId: string | undefined, role: Message['role']): Message => ({
	id,
	conversationId: 'original',
	parentId,
	role,
	content: `content of ${id}`,
	createdAt: Number(id),
});

// original: 1 (prompt) → 2 (answer) → 3 (prompt) → 4 (answer), and 5 is a second version of 2.
const ORIGINAL: Message[] = [
	msg('1', undefined, 'user'),
	msg('2', '1', 'assistant'),
	msg('3', '2', 'user'),
	msg('4', '3', 'assistant'),
	msg('5', '1', 'assistant'),
];

describe('inheritedHistory', () => {
	it('returns the path from the first message to the branch point, oldest first', () => {
		const inherited = inheritedHistory(ORIGINAL, '2', 'branch');

		expect(inherited.map(m => m.id)).toEqual(['1', '2']);
	});

	it('files the copies under the branch and leaves the originals untouched', () => {
		const inherited = inheritedHistory(ORIGINAL, '2', 'branch');

		expect(inherited.every(m => m.conversationId === 'branch')).toBe(true);
		expect(ORIGINAL.every(m => m.conversationId === 'original')).toBe(true);
		expect(inherited[1].content).toBe('content of 2');
	});

	it('leaves out messages added after the branch point and other versions off the path', () => {
		const inherited = inheritedHistory(ORIGINAL, '2', 'branch');

		expect(inherited.map(m => m.id)).not.toContain('3');
		expect(inherited.map(m => m.id)).not.toContain('4');
		expect(inherited.map(m => m.id)).not.toContain('5');
	});

	it('follows the version that was branched from, not the first one', () => {
		expect(inheritedHistory(ORIGINAL, '5', 'branch').map(m => m.id)).toEqual(['1', '5']);
	});

	it('returns nothing when the branch point is not among the messages', () => {
		expect(inheritedHistory(ORIGINAL, '99', 'branch')).toEqual([]);
		expect(inheritedHistory([], '2', 'branch')).toEqual([]);
	});

	it('stops at a parent that is missing, keeping what it reached', () => {
		const withoutRoot = ORIGINAL.filter(m => m.id !== '1');

		expect(inheritedHistory(withoutRoot, '4', 'branch').map(m => m.id)).toEqual(['2', '3', '4']);
	});

	it('follows a parent link stored as a number', () => {
		// Messages written on the device that sent them can carry a numeric parent id.
		const withNumericLink = ORIGINAL.map(m =>
			m.id === '2' ? ({ ...m, parentId: 1 } as unknown as Message) : m,
		);

		expect(inheritedHistory(withNumericLink, '2', 'branch').map(m => m.id)).toEqual(['1', '2']);
	});

	it('says whether a path goes all the way back to the first message', () => {
		expect(reachesFirstMessage(inheritedHistory(ORIGINAL, '4', 'branch'))).toBe(true);
		expect(reachesFirstMessage(inheritedHistory(ORIGINAL.slice(1), '4', 'branch'))).toBe(false);
		expect(reachesFirstMessage([])).toBe(false);
	});

	it('ends on a parent loop instead of running for ever', () => {
		const loop: Message[] = [msg('1', '2', 'user'), msg('2', '1', 'assistant')];

		expect(inheritedHistory(loop, '2', 'branch').map(m => m.id)).toEqual(['1', '2']);
	});
});
