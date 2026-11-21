import { describe, expect, it } from 'vitest';

import { decryptData } from '@/lib/crypto';

import {
	DONE_OUTCOMES,
	FRAME_TYPES,
	isAnswerMessageId,
	isSealedFrame,
	LIMITS,
	parseFramePlaintext,
	parseSseEventId,
	RESET_REASONS,
	SSE_EVENT_NAME,
	STREAM_CONTRACT_VERSION,
	STREAM_HTTP,
	STREAM_REFUSAL_STATUSES,
	streamUrl,
} from './contract';
import { importVectorKey, VECTOR } from './vector.testdata';

const frameOf = (overrides: Record<string, unknown>) => ({
	v: 1,
	answerMessageId: '42',
	run: '0123456789abcdef',
	seq: 1,
	replica: 'deadbeef',
	...overrides,
});

describe('the live reasoning contract (version 1)', () => {
	describe('the shared test vector', () => {
		it("decrypts the vector's frame with the vector's key to the vector's plaintext", async () => {
			const key = await importVectorKey();

			const plain = await decryptData(key, VECTOR.frame);

			expect(JSON.stringify(plain)).toBe(VECTOR.plaintext);
		});

		it("accepts the vector's plaintext as a step frame", () => {
			const frame = parseFramePlaintext(JSON.parse(VECTOR.plaintext));

			expect(frame).toEqual(JSON.parse(VECTOR.plaintext));
			expect(frame?.type).toBe('step');
		});

		it("reads the vector's frame as one sealed SSE data line", () => {
			expect(isSealedFrame(VECTOR.frame)).toBe(true);
			expect(isSealedFrame('not sealed')).toBe(false);
			expect(isSealedFrame(`${VECTOR.frame}\nid: x`)).toBe(false);
		});
	});

	describe('vocabulary and limits, equal to the oracle', () => {
		it('names the six frame types, the reset reasons, the done outcomes and the event name', () => {
			expect(Object.values(FRAME_TYPES)).toEqual([
				'reset',
				'sources',
				'step',
				'attempt',
				'answer',
				'done',
			]);
			expect(RESET_REASONS).toEqual(['start', 'retry']);
			expect(DONE_OUTCOMES).toEqual(['answered', 'abandoned', 'interrupted']);
			expect(SSE_EVENT_NAME).toBe('frame');
			expect(STREAM_CONTRACT_VERSION).toBe(1);
		});

		it('holds the same limits as the oracle', () => {
			expect(LIMITS).toEqual({
				maxSourcesPerFrame: 20,
				sourceTitleChars: 300,
				sourceUrlChars: 2048,
				stepTitleChars: 120,
				stepDescriptionChars: 4000,
				maxStepsPerAttempt: 64,
				maxAttempts: 4,
				answerTextBytes: 64 * 1024,
				framePlaintextBytes: 16 * 1024,
			});
		});

		it('holds the HTTP names and the statuses of every refusal', () => {
			expect(STREAM_HTTP.proofHeader).toBe('X-SenseAI-Stream-Proof');
			expect(STREAM_HTTP.lastEventIdHeader).toBe('Last-Event-ID');
			expect(STREAM_HTTP.streamPathPrefix).toBe('/stream/');
			expect(STREAM_HTTP.sseRetryMs).toBe(2000);
			expect(STREAM_REFUSAL_STATUSES).toEqual({
				badRequest: 400,
				proof: 403,
				notOpen: 404,
				finished: 410,
				busy: 429,
				unavailable: 503,
			});
		});
	});

	describe('identities', () => {
		it('accepts canonical uint256 decimal answer ids only', () => {
			['0', '1', '42', '9'.repeat(78)].forEach(id => expect(isAnswerMessageId(id)).toBe(true));
			['00', '01', '9'.repeat(79), '-0', '1e3', ' 1', '', null, 1].forEach(id =>
				expect(isAnswerMessageId(id)).toBe(false),
			);
		});

		it('reads the SSE event id as <run>.<seq>', () => {
			expect(parseSseEventId('0123456789abcdef.7')).toEqual({ run: '0123456789abcdef', seq: 7 });
			['7', '0123456789abcdef', '0123456789abcdef.-1', '0123456789abcdef.07', 'x.1', ''].forEach(
				bad => expect(parseSseEventId(bad)).toBeNull(),
			);
		});

		it('builds the stream URL with the id in the path and never anything else', () => {
			expect(streamUrl({ url: 'https://s.example', mode: 'sse' }, '42')).toBe(
				'https://s.example/stream/42',
			);
			expect(streamUrl({ url: 'https://s.example/live', mode: 'poll' }, '42')).toBe(
				'https://s.example/live/stream/42?mode=poll',
			);
		});
	});

	describe('frame validation', () => {
		it('accepts each frame type in its contract shape', () => {
			const frames = [
				frameOf({ seq: 0, type: 'reset', data: { reason: 'retry' } }),
				frameOf({
					type: 'sources',
					data: { attempt: 1, sources: [{ title: 'News', url: 'https://n.example/a' }] },
				}),
				frameOf({ type: 'attempt', data: { attempt: 2 } }),
				frameOf({ type: 'answer', data: { text: 'Up.', answerMessageCID: 'bafy1' } }),
				frameOf({
					type: 'answer',
					data: { text: 'Up.', answerMessageCID: 'bafy1', reasoningDuration: 4 },
				}),
				frameOf({ type: 'done', data: { outcome: 'interrupted' } }),
			];

			frames.forEach(frame => expect(parseFramePlaintext(frame)).not.toBeNull());
		});

		it('refuses frames outside the contract', () => {
			const bad = [
				frameOf({ v: 2, type: 'done', data: { outcome: 'answered' } }),
				frameOf({ answerMessageId: '042', type: 'done', data: { outcome: 'answered' } }),
				frameOf({ run: 'XYZ', type: 'done', data: { outcome: 'answered' } }),
				frameOf({ seq: -1, type: 'done', data: { outcome: 'answered' } }),
				frameOf({ replica: 'Bad Replica', type: 'done', data: { outcome: 'answered' } }),
				frameOf({ type: 'token', data: {} }),
				frameOf({ type: 'done', data: { outcome: 'maybe' } }),
				frameOf({ type: 'reset', data: { reason: 'later' } }),
				frameOf({ type: 'step', data: { attempt: 1, title: 'x'.repeat(121), description: 'd' } }),
				frameOf({
					type: 'step',
					data: { attempt: 1, title: 't', description: 'd'.repeat(4001) },
				}),
				frameOf({ type: 'step', data: { attempt: 5, title: 't', description: 'd' } }),
				frameOf({ type: 'attempt', data: { attempt: 1 } }),
				frameOf({
					type: 'sources',
					data: { attempt: 1, sources: [{ title: 'x', url: 'javascript:alert(1)' }] },
				}),
				frameOf({
					type: 'sources',
					data: {
						attempt: 1,
						sources: Array.from({ length: 21 }, (_, i) => ({
							title: `s${i}`,
							url: 'https://n.example',
						})),
					},
				}),
				frameOf({
					type: 'answer',
					data: { text: 'é'.repeat(32 * 1024 + 1), answerMessageCID: 'bafy1' },
				}),
				null,
				'a string',
			];

			bad.forEach(frame => expect(parseFramePlaintext(frame)).toBeNull());
		});

		it('accepts a sources list shorter than the limit, as the oracle trims to fit a frame', () => {
			const frame = frameOf({ type: 'sources', data: { attempt: 3, sources: [] } });

			expect(parseFramePlaintext(frame)).not.toBeNull();
		});
	});
});
