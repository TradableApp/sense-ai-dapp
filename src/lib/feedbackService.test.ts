import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { importVectorKey } from '@/lib/liveReasoning/vector.testdata';

import { RATING_DOC_ID, ratingDocId } from './answerRating';
import sendAiFeedback from './feedbackService';

const callable = vi.fn();
const httpsCallableMock = vi.fn((_functions: unknown, _name: string) => callable);

vi.mock('firebase/functions', () => ({
	httpsCallable: (functions: unknown, name: string) => httpsCallableMock(functions, name),
}));
vi.mock('@/config/firebase', () => ({ functions: { name: 'test-functions' }, db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AGENT = '0x00000000000000000000000000000000000000A1';

describe('sendAiFeedback', () => {
	beforeEach(() => {
		callable.mockReset();
		httpsCallableMock.mockClear();
		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('sends only the rating id, the value, the chain id and the agent address', async () => {
		callable.mockResolvedValue({ data: { success: true } });
		const sessionKey = await importVectorKey();

		await sendAiFeedback({ sessionKey, conversationId: '7', messageId: 42, feedbackValue: 'like' });

		expect(httpsCallableMock).toHaveBeenCalledWith({ name: 'test-functions' }, 'submitAiFeedback');
		expect(callable).toHaveBeenCalledTimes(1);
		const payload = callable.mock.calls[0][0];
		expect(payload).toEqual({
			docId: await ratingDocId(sessionKey, {
				chainId: '84532',
				agentAddress: AGENT,
				conversationId: '7',
				messageId: '42',
			}),
			feedbackValue: 'like',
			chainId: '84532',
			agentAddress: AGENT.toLowerCase(),
		});
		expect(payload.docId).toMatch(RATING_DOC_ID);
	});

	it('sends null to remove a rating', async () => {
		callable.mockResolvedValue({ data: { success: true } });
		const sessionKey = await importVectorKey();

		await sendAiFeedback({ sessionKey, conversationId: '7', messageId: '42', feedbackValue: null });

		expect(callable.mock.calls[0][0].feedbackValue).toBeNull();
	});

	it('sends nothing and fails when the build names no usable chain or agent', async () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const sessionKey = await importVectorKey();

		await expect(
			sendAiFeedback({ sessionKey, conversationId: '7', messageId: '42', feedbackValue: 'like' }),
		).rejects.toThrow();
		expect(callable).not.toHaveBeenCalled();
	});

	it('logs the error by its name only, never the rating id', async () => {
		const sessionKey = await importVectorKey();
		const docId = await ratingDocId(sessionKey, {
			chainId: '84532',
			agentAddress: AGENT,
			conversationId: '7',
			messageId: '42',
		});
		const failure = new Error(`refused for ${docId}`);
		failure.name = 'FirebaseError';
		callable.mockRejectedValue(failure);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(
			sendAiFeedback({ sessionKey, conversationId: '7', messageId: '42', feedbackValue: 'like' }),
		).rejects.toBe(failure);

		const logged = errorLog.mock.calls.flat().map(String).join(' ');
		expect(logged).toContain('FirebaseError');
		expect(logged).not.toContain(docId);
	});
});
