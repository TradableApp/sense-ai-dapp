import { describe, expect, it } from 'vitest';

import mergeMessages from './mergeMessages';
import type { Message } from './types';

const msg = (over: Partial<Message>): Message => ({
	id: 'm1',
	conversationId: 'c1',
	role: 'assistant',
	content: null,
	createdAt: 1000,
	...over,
});

describe('mergeMessages', () => {
	it('takes the incoming message when it has content (Graph is authority)', () => {
		const existing = [msg({ id: 'm1', content: 'old', createdAt: 1000 })];
		const incoming = [msg({ id: 'm1', content: 'new', createdAt: 1000 })];

		const result = mergeMessages(existing, incoming);

		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('new');
	});

	it('does NOT clobber existing content when the incoming message is content-less', () => {
		// The bug: a sync cycle that returns the message but fails to (re)hydrate its
		// content from storage must not wipe the answer we already have cached.
		const existing = [msg({ id: 'm1', role: 'assistant', content: 'the answer', createdAt: 1000 })];
		const incoming = [msg({ id: 'm1', role: 'assistant', content: '', createdAt: 1000 })];

		const result = mergeMessages(existing, incoming);

		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('the answer');
	});

	it('does NOT clobber existing content when the incoming content is null', () => {
		const existing = [msg({ id: 'm1', content: 'the answer' })];
		const incoming = [msg({ id: 'm1', content: null })];

		expect(mergeMessages(existing, incoming)[0].content).toBe('the answer');
	});

	it('takes the incoming message when both sides are content-less (no false preserve)', () => {
		// The conditional boundary the fix guards: prev exists, incoming is content-less,
		// but existing is ALSO content-less → the preserve branch must NOT fire (nothing
		// to preserve), so the incoming (with its fresh status/metadata) wins.
		const existing = [msg({ id: 'm1', content: null })];
		const incoming = [msg({ id: 'm1', content: '', parentId: 'p9' })];

		const merged = mergeMessages(existing, incoming)[0];
		expect(merged.content).toBe('');
		expect(merged.parentId).toBe('p9');
	});

	it('keeps the incoming non-content fields while preserving existing content', () => {
		const existing = [msg({ id: 'm1', content: 'the answer', parentId: undefined })];
		const incoming = [msg({ id: 'm1', content: '', parentId: 'p9' })];

		const merged = mergeMessages(existing, incoming)[0];
		expect(merged.content).toBe('the answer');
		expect(merged.parentId).toBe('p9'); // Graph metadata still applied
	});

	it('adds new incoming messages not present in the cache', () => {
		const existing = [msg({ id: 'm1', content: 'a', createdAt: 1000 })];
		const incoming = [msg({ id: 'm2', content: 'b', createdAt: 2000 })];

		const result = mergeMessages(existing, incoming);
		expect(result.map(m => m.id)).toEqual(['m1', 'm2']);
	});

	it('preserves existing messages absent from the incoming set (history)', () => {
		const existing = [
			msg({ id: 'm1', content: 'a', createdAt: 1000 }),
			msg({ id: 'm2', content: 'b', createdAt: 2000 }),
		];
		const incoming = [msg({ id: 'm2', content: 'b2', createdAt: 2000 })];

		const result = mergeMessages(existing, incoming);
		expect(result.map(m => m.id)).toEqual(['m1', 'm2']);
		expect(result[1].content).toBe('b2');
	});

	it('returns messages sorted by createdAt', () => {
		const existing = [msg({ id: 'm2', content: 'b', createdAt: 2000 })];
		const incoming = [msg({ id: 'm1', content: 'a', createdAt: 1000 })];

		expect(mergeMessages(existing, incoming).map(m => m.createdAt)).toEqual([1000, 2000]);
	});

	it('collapses duplicate ids within the incoming batch (last wins)', () => {
		const incoming = [
			msg({ id: 'm1', content: 'first', createdAt: 1000 }),
			msg({ id: 'm1', content: 'second', createdAt: 1000 }),
		];

		const result = mergeMessages([], incoming);
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe('second');
	});
});
