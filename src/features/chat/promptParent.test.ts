import { describe, expect, it } from 'vitest';

import promptParentFor from './promptParent';

const shown = (id: string, messageCID: string | null = `cid-${id}`) => ({ id, messageCID });

describe('promptParentFor — what a new prompt threads off', () => {
	it('threads off the last message shown', () => {
		const result = promptParentFor([shown('51'), shown('53')], { hasBranchOrigin: false });

		expect(result).toEqual({ kind: 'parent', parentId: 53, parentCID: 'cid-53' });
	});

	it('has no parent in a conversation that shows nothing and is not a branch', () => {
		expect(promptParentFor([], { hasBranchOrigin: false })).toEqual({
			kind: 'parent',
			parentId: null,
			parentCID: null,
		});
		expect(promptParentFor(undefined, { hasBranchOrigin: false })).toEqual({
			kind: 'parent',
			parentId: null,
			parentCID: null,
		});
	});

	it('threads off the last message shown in a branch', () => {
		const result = promptParentFor([shown('2'), shown('6')], { hasBranchOrigin: true });

		expect(result).toEqual({ kind: 'parent', parentId: 6, parentCID: 'cid-6' });
	});

	it('holds the prompt in a branch that shows nothing', () => {
		// The branch's history is on another device or not loaded yet. A prompt sent now would
		// have no parent, and the answer would be stored as the start of a conversation.
		expect(promptParentFor([], { hasBranchOrigin: true })).toEqual({ kind: 'hold' });
		expect(promptParentFor(undefined, { hasBranchOrigin: true })).toEqual({ kind: 'hold' });
	});

	it('keeps a parent id of 0', () => {
		expect(promptParentFor([shown('0')], { hasBranchOrigin: false })).toEqual({
			kind: 'parent',
			parentId: 0,
			parentCID: 'cid-0',
		});
	});

	it('has no parent when the last message shown has no usable id', () => {
		const result = promptParentFor([{ id: undefined, messageCID: null }], {
			hasBranchOrigin: false,
		});

		expect(result).toEqual({ kind: 'parent', parentId: null, parentCID: null });
	});

	it('holds the prompt in a branch whose last message shown has no usable id', () => {
		const result = promptParentFor([{ id: undefined, messageCID: null }], {
			hasBranchOrigin: true,
		});

		expect(result).toEqual({ kind: 'hold' });
	});
});
