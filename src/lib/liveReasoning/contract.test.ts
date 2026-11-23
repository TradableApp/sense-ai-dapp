import { describe, expect, it, vi } from 'vitest';

import { decryptBytes, decryptData, encryptData } from '@/lib/crypto';

import {
	DONE_OUTCOMES,
	FRAME_TYPES,
	isAnswerMessageId,
	isSealedFrame,
	LIMITS,
	MAX_SEALED_FRAME_CHARS,
	parseFrameBytes,
	parseFramePlaintext,
	parseSseEventId,
	RESET_REASONS,
	sealedFrameChars,
	SSE_EVENT_NAME,
	STREAM_CONTRACT_VERSION,
	STREAM_HTTP,
	STREAM_REFUSAL_STATUSES,
	streamUrl,
} from './contract';
import {
	bytesToHex,
	canonicalJson,
	hexBytes,
	importVectorKey,
	STREAM_VECTORS,
	STREAM_VECTORS_SHA256,
} from './vector.testdata';

const frameOf = (overrides: Record<string, unknown>) => ({
	v: 1,
	answerMessageId: '42',
	run: '0123456789abcdef',
	seq: 1,
	replica: 'deadbeef',
	...overrides,
});

describe('the live reasoning contract (version 1)', () => {
	describe('the shared test vectors', () => {
		const vectorOf = (type: string) => STREAM_VECTORS.frames.find(v => v.type === type);

		it('holds one vector for every frame type the contract defines, each with its own IV', () => {
			const types = STREAM_VECTORS.frames.map(v => v.type);
			const ivs = STREAM_VECTORS.frames.map(v => v.ivHex);

			expect([...types].sort()).toEqual(Object.values(FRAME_TYPES).sort());
			expect(new Set(ivs).size).toBe(ivs.length);
		});

		it('pins the SHA-256 of the canonical vector data, the same hash the oracle pins', async () => {
			const bytes = new TextEncoder().encode(canonicalJson(STREAM_VECTORS));
			const digest = await window.crypto.subtle.digest('SHA-256', bytes);

			expect(bytesToHex(new Uint8Array(digest))).toBe(STREAM_VECTORS_SHA256);
		});

		it('serialises canonically: keys sorted at every level, arrays in order, no whitespace', () => {
			expect(canonicalJson({ b: 1, a: [{ d: 2.5, c: 'é\n' }, null, true] })).toBe(
				'{"a":[{"c":"é\\n","d":2.5},null,true],"b":1}',
			);
		});

		describe.each(Object.values(FRAME_TYPES))('the %s vector', type => {
			it('exists', () => {
				expect(vectorOf(type)).toBeDefined();
			});

			it('decrypts to its plaintext, which the schema accepts as that frame type', async () => {
				const vector = vectorOf(type);
				const key = await importVectorKey();

				const plain = await decryptData(key, vector?.frame ?? '');
				const frame = parseFrameBytes(await decryptBytes(key, vector?.frame ?? ''));

				expect(JSON.stringify(plain)).toBe(vector?.plaintext);
				expect(frame).toEqual(JSON.parse(vector?.plaintext ?? 'null'));
				expect(frame?.type).toBe(type);
				expect(isSealedFrame(vector?.frame)).toBe(true);
			});

			it('encrypts its plaintext to its frame, byte for byte, with the fixed key and IV', async () => {
				const vector = vectorOf(type);
				const key = await importVectorKey();
				const iv = hexBytes(vector?.ivHex ?? '');
				// encryptData draws its IV from getRandomValues; the vector's IV is handed in there.
				const spy = vi
					.spyOn(window.crypto, 'getRandomValues')
					.mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
						(array as unknown as Uint8Array).set(iv);
						return array;
					});

				try {
					const sealed = await encryptData(key, JSON.parse(vector?.plaintext ?? 'null'));

					expect(sealed).toBe(vector?.frame);
				} finally {
					spy.mockRestore();
				}
			});
		});

		it("reads each vector's frame as one sealed SSE data line", () => {
			const { frame } = STREAM_VECTORS.frames[0];

			expect(isSealedFrame(frame)).toBe(true);
			expect(isSealedFrame('not sealed')).toBe(false);
			expect(isSealedFrame(`${frame}\nid: x`)).toBe(false);
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
				answerFramePlaintextBytes: 6 * 64 * 1024 + 1024,
				answerCidChars: 128,
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

	describe('frame sizes and content ids', () => {
		const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
		const answer = (cid: string) =>
			frameOf({ type: 'answer', data: { text: 'Up.', answerMessageCID: cid } });
		/** A frame of exactly `bytes` bytes of JSON, padded by a field the schema does not keep. */
		const padded = (frame: Record<string, unknown>, bytes: number) => {
			const bare = utf8({ ...frame, pad: '' }).length;
			return utf8({ ...frame, pad: 'x'.repeat(bytes - bare) });
		};
		const STEP = frameOf({ type: 'step', data: { attempt: 1, title: 't', description: 'd' } });

		it('accepts the content ids the storage paths produce, up to the limit, and nothing else', () => {
			[
				`bafkr6i${'a'.repeat(52)}`,
				`bafybei${'b'.repeat(52)}`,
				'A'.repeat(43),
				`${'a_-'.repeat(14)}Zz`,
				`mock_${'0'.repeat(20)}`,
				'x'.repeat(128),
			].forEach(cid => expect(parseFramePlaintext(answer(cid))).not.toBeNull());
			['', 'x'.repeat(129), 'bafy.x', 'bafy/x', 'bafy x', 'bafyé', 'a+b', 'a=b'].forEach(cid =>
				expect(parseFramePlaintext(answer(cid))).toBeNull(),
			);
		});

		it('counts a sealed frame as the oracle and the encryptor write it', async () => {
			const key = await importVectorKey();
			const sizes = [0, 1, 2, 3, 100, 16 * 1024];
			const sealed = await Promise.all(sizes.map(n => encryptData(key, 'x'.repeat(n))));
			// JSON.stringify of a string adds its two quotes.
			expect(sealed.map(s => s.length)).toEqual(sizes.map(n => sealedFrameChars(n + 2)));
			expect(MAX_SEALED_FRAME_CHARS).toBe(sealedFrameChars(LIMITS.answerFramePlaintextBytes));
			expect(MAX_SEALED_FRAME_CHARS).toBe(525_693);
		});

		it('refuses sealed text longer than the largest frame, before decrypting', () => {
			const atLimit = `${'A'.repeat(16)}.${'B'.repeat(MAX_SEALED_FRAME_CHARS - 17)}`;

			expect(atLimit).toHaveLength(MAX_SEALED_FRAME_CHARS);
			expect(isSealedFrame(atLimit)).toBe(true);
			expect(isSealedFrame(`${atLimit}B`)).toBe(false);
		});

		it('refuses plaintext over the answer frame limit before parsing it', () => {
			const ANSWER = answer('bafy1');

			expect(parseFrameBytes(padded(ANSWER, LIMITS.answerFramePlaintextBytes))).not.toBeNull();
			expect(parseFrameBytes(padded(ANSWER, LIMITS.answerFramePlaintextBytes + 1))).toBeNull();
		});

		it('neither decodes nor parses plaintext over the answer frame limit', () => {
			const over = padded(answer('bafy1'), LIMITS.answerFramePlaintextBytes + 1);
			const parse = vi.spyOn(JSON, 'parse');
			const decode = vi.spyOn(TextDecoder.prototype, 'decode');

			try {
				expect(parseFrameBytes(over)).toBeNull();
				expect(parse).not.toHaveBeenCalled();
				expect(decode).not.toHaveBeenCalled();
			} finally {
				parse.mockRestore();
				decode.mockRestore();
			}
		});

		it('holds every frame but the answer to the frame limit', () => {
			expect(parseFrameBytes(padded(STEP, LIMITS.framePlaintextBytes))).toEqual(STEP);
			expect(parseFrameBytes(padded(STEP, LIMITS.framePlaintextBytes + 1))).toBeNull();
			expect(
				parseFrameBytes(padded(answer('bafy1'), LIMITS.framePlaintextBytes + 1)),
			).not.toBeNull();
		});

		it('takes bytes that are not UTF-8 JSON as no frame, without throwing', () => {
			expect(parseFrameBytes(new Uint8Array([0xff, 0xfe]))).toBeNull();
			expect(parseFrameBytes(new TextEncoder().encode('{"v":1'))).toBeNull();
			expect(parseFrameBytes(new Uint8Array())).toBeNull();
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
					data: {
						attempt: 1,
						sources: [{ title: 'x', url: ['javascript', 'alert(1)'].join(':') }],
					},
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

		it('refuses a source whose URL is not http or https, whatever its case', () => {
			const withUrl = (url: string) =>
				frameOf({ type: 'sources', data: { attempt: 1, sources: [{ title: 'x', url }] } });

			[
				['JaVaScRiPt', 'alert(1)'].join(':'),
				'data:text/html,hi',
				'/relative/path',
				'vbscript:msgbox(1)',
			].forEach(url => expect(parseFramePlaintext(withUrl(url))).toBeNull());
			expect(parseFramePlaintext(withUrl('https://news.example'))).not.toBeNull();
		});

		it('accepts a sources list shorter than the limit, as the oracle trims to fit a frame', () => {
			const frame = frameOf({ type: 'sources', data: { attempt: 3, sources: [] } });

			expect(parseFramePlaintext(frame)).not.toBeNull();
		});
	});
});
