import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('thirdweb', () => ({}));
vi.mock('thirdweb/react', () => ({}));
vi.mock('thirdweb/wallets', () => ({}));
vi.mock('@/lib/ecies', () => ({
	default: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));
vi.mock('@/lib/crypto', () => ({
	encryptData: vi.fn(async () => 'iv.cipher'),
	decryptData: vi.fn(),
	deriveKeyFromEntropy: vi.fn(),
}));
vi.mock('@/lib/faucetService', () => ({ default: vi.fn() }));

import { buildInitiatePromptPayload, createEncryptedPayloads } from './useChatMutations';

describe('createEncryptedPayloads', () => {
	beforeEach(() => {
		vi.spyOn(window.crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32));
		// @ts-expect-error intentionally removing env var to test missing-key path
		delete import.meta.env.VITE_ORACLE_PUBLIC_KEY;
	});

	it('throws when VITE_ORACLE_PUBLIC_KEY is not set', async () => {
		const mockKey = {} as CryptoKey;
		const payload = { test: 'data' };

		await expect(createEncryptedPayloads(mockKey, payload)).rejects.toThrow(
			'VITE_ORACLE_PUBLIC_KEY is not set in .env',
		);
	});
});

describe('buildInitiatePromptPayload', () => {
	// The oracle's payload validator requires previousMessageId to be a string (or
	// null); a numeric id is rejected and the prompt is silently dropped, so a
	// follow-up never gets answered. The client carries parentId numerically, so the
	// payload boundary must coerce it.
	it('stringifies a numeric previousMessageId so the oracle accepts it', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'follow-up',
			conversationId: 1,
			parentId: 53,
			parentCID: 'cid',
		});

		expect(payload.previousMessageId).toBe('53');
	});

	it('preserves a parent message id of 0 instead of collapsing it to null', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'q',
			conversationId: 1,
			parentId: 0,
			parentCID: null,
		});

		expect(payload.previousMessageId).toBe('0');
	});

	it('maps a null parent (new conversation) to null', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'first',
			conversationId: 0,
			parentId: null,
			parentCID: null,
		});

		expect(payload.previousMessageId).toBeNull();
		expect(payload.isNewConversation).toBe(true);
	});

	// Orphaned-after-cancel: the conversation exists (non-zero id) but its only prior
	// prompt was cancelled, so no answer was ever delivered and ConversationAdded never
	// fired. The resend must be treated as new so the oracle re-initialises the
	// conversation and ConversationAdded finally fires (else the answer never indexes).
	it('treats a resend into a conversation with no delivered answer as new', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'now please answer',
			conversationId: 3,
			parentId: 4,
			parentCID: null,
			conversationHasAnswer: false,
		});

		expect(payload.isNewConversation).toBe(true);
	});

	// A normal follow-up into a conversation that already has a delivered answer is NOT
	// new — re-initialising would re-emit ConversationAdded and wipe the conversation's
	// metadata (title/rename/delete).
	it('keeps a follow-up into an answered conversation as not new', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'follow-up',
			conversationId: 3,
			parentId: 5,
			parentCID: 'cid',
			conversationHasAnswer: true,
		});

		expect(payload.isNewConversation).toBe(false);
	});

	// Backward-compatible default: when the flag is omitted, an existing conversationId
	// stays not-new (the prior behaviour).
	it('defaults to not-new for an existing conversation when the flag is omitted', () => {
		const payload = buildInitiatePromptPayload({
			promptText: 'follow-up',
			conversationId: 3,
			parentId: 5,
			parentCID: 'cid',
		});

		expect(payload.isNewConversation).toBe(false);
	});
});
