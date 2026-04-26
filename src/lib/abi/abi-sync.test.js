// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const abiDir = path.resolve(import.meta.dirname);

function loadAbi(filename) {
	return JSON.parse(readFileSync(path.join(abiDir, filename), 'utf8'));
}

describe('EVMAIAgent ABI — PromptSubmitted event', () => {
	const raw = loadAbi('EVMAIAgent.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	const event = abi.find(x => x.type === 'event' && x.name === 'PromptSubmitted');

	it('event exists', () => {
		expect(event).toBeDefined();
	});

	it('has 6 inputs', () => {
		expect(event.inputs).toHaveLength(6);
	});

	it('user is indexed', () => {
		expect(event.inputs[0]).toMatchObject({ name: 'user', indexed: true });
	});

	it('conversationId is indexed', () => {
		expect(event.inputs[1]).toMatchObject({ name: 'conversationId', indexed: true });
	});

	it('promptMessageId is indexed', () => {
		expect(event.inputs[2]).toMatchObject({ name: 'promptMessageId', indexed: true });
	});

	it('answerMessageId is NOT indexed', () => {
		expect(event.inputs[3]).toMatchObject({ name: 'answerMessageId', indexed: false });
	});

	it('encryptedPayload is not indexed', () => {
		expect(event.inputs[4]).toMatchObject({ name: 'encryptedPayload', indexed: false });
	});

	it('roflEncryptedKey is not indexed', () => {
		expect(event.inputs[5]).toMatchObject({ name: 'roflEncryptedKey', indexed: false });
	});
});

describe('AbleToken ABI — custom errors used by buildErrorHandler', () => {
	const raw = loadAbi('AbleToken.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	it('ERC20InsufficientBalance error exists', () => {
		const entry = abi.find(x => x.type === 'error' && x.name === 'ERC20InsufficientBalance');
		expect(entry).toBeDefined();
	});

	it('ERC20InsufficientAllowance error exists', () => {
		const entry = abi.find(x => x.type === 'error' && x.name === 'ERC20InsufficientAllowance');
		expect(entry).toBeDefined();
	});
});

describe('EVMAIAgentEscrow ABI — cancelPrompt and processRefund', () => {
	const raw = loadAbi('EVMAIAgentEscrow.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	it('cancelPrompt accepts _answerMessageId uint256', () => {
		const fn = abi.find(x => x.type === 'function' && x.name === 'cancelPrompt');
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(1);
		expect(fn.inputs[0]).toMatchObject({ name: '_answerMessageId', type: 'uint256' });
	});

	it('processRefund accepts _answerMessageId uint256', () => {
		const fn = abi.find(x => x.type === 'function' && x.name === 'processRefund');
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(1);
		expect(fn.inputs[0]).toMatchObject({ name: '_answerMessageId', type: 'uint256' });
	});
});
