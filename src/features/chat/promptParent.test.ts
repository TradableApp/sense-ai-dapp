import { describe, expect, it } from 'vitest';

import promptParentFor, { composerStateFor } from './promptParent';

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

describe('composerStateFor — whether a prompt can be sent now', () => {
	const settled = {
		activeConversationId: '7',
		conversation: { branchedFromConversationId: null } as {
			branchedFromConversationId?: string | null;
		},
		isConversationSettled: true,
		messagesShown: [shown('51'), shown('53')],
		areMessagesSettled: true,
	};
	const branch = { branchedFromConversationId: '3' };

	it('is ready with no parent when there is no conversation yet', () => {
		expect(
			composerStateFor({
				activeConversationId: null,
				conversation: undefined,
				isConversationSettled: false,
				messagesShown: [],
				areMessagesSettled: false,
			}),
		).toEqual({ kind: 'ready', parentId: null, parentCID: null, hasBranchOrigin: false });
	});

	it('is ready, threading off the last message shown, in a conversation that has loaded', () => {
		expect(composerStateFor(settled)).toEqual({
			kind: 'ready',
			parentId: 53,
			parentCID: 'cid-53',
			hasBranchOrigin: false,
		});
	});

	it('is loading while the messages of the conversation have not been read', () => {
		// Opening a branch shows nothing for the length of the read. That is not a branch
		// without its history, and saying so on every open would be wrong.
		expect(
			composerStateFor({
				...settled,
				conversation: branch,
				messagesShown: [],
				areMessagesSettled: false,
			}),
		).toEqual({ kind: 'loading' });
	});

	it('is loading while it is not known whether the conversation is a branch', () => {
		// Right after a branch is made its record is not in the list yet. A prompt sent in that
		// moment with nothing shown would go out with no parent, flagged new.
		expect(
			composerStateFor({
				...settled,
				conversation: undefined,
				isConversationSettled: false,
				messagesShown: [],
			}),
		).toEqual({ kind: 'loading' });
	});

	it('stays ready while messages on screen are being read again', () => {
		// A background re-read must not disable a composer someone is typing in.
		expect(composerStateFor({ ...settled, areMessagesSettled: false })).toEqual({
			kind: 'ready',
			parentId: 53,
			parentCID: 'cid-53',
			hasBranchOrigin: false,
		});
	});

	it('holds a branch that shows nothing once everything has been read', () => {
		expect(composerStateFor({ ...settled, conversation: branch, messagesShown: [] })).toEqual({
			kind: 'hold',
		});
	});

	it('is ready in a branch that shows messages, and says it is a branch', () => {
		expect(composerStateFor({ ...settled, conversation: branch })).toEqual({
			kind: 'ready',
			parentId: 53,
			parentCID: 'cid-53',
			hasBranchOrigin: true,
		});
	});

	it('treats a conversation with no record, once that is settled, as not a branch', () => {
		// A conversation whose only prompts were cancelled has no stored record; its resend has
		// no parent and is flagged new, as before.
		expect(composerStateFor({ ...settled, conversation: undefined, messagesShown: [] })).toEqual({
			kind: 'ready',
			parentId: null,
			parentCID: null,
			hasBranchOrigin: false,
		});
	});
});
