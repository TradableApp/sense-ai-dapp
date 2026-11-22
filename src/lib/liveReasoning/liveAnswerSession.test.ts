import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptData } from '@/lib/crypto';
import {
	type FrameStreamOptions,
	MAX_STALLED_CONNECTIONS,
	startFrameStream,
	type StreamFetch,
	type StreamResponse,
} from '@/lib/liveReasoning/frameTransport';
import type { LiveAnswerState } from '@/lib/liveReasoning/liveReducer';

import { type SessionEnd, startLiveAnswerSession } from './liveAnswerSession';

vi.mock('@/lib/crypto', () => ({ decryptData: vi.fn() }));
vi.mock('@/lib/liveReasoning/streamProof', () => ({ default: async () => 'proof-42' }));

const RUN = '0123456789abcdef';
/** A well-formed sealed frame naming its seq; what it decrypts to is up to the mocked `decryptData`. */
const sealed = (seq: number) => `aXY=.${btoa(`seq${seq}`)}`;
const seqOfSealed = (data: string) => Number(atob(data.split('.')[1]).slice(3));
const ENDPOINT = { url: 'https://stream.example', mode: 'poll' as const };
const LONG_SPAN_MS = 30 * 60 * 1000;
/** The most requests a test answers before it stops responding (a storm shows as this count). */
const STORM_CAP = 1_000;

const frame = (seq: number, body: { type: string; data: unknown }) => ({
	v: 1,
	answerMessageId: '42',
	run: RUN,
	seq,
	replica: 'deadbeef',
	...body,
});
const RESET = { type: 'reset', data: { reason: 'start' } };
const STEP = { type: 'step', data: { attempt: 1, title: 'Reading', description: 'Read it.' } };

function onePoll(seq: number): StreamResponse {
	const text = `retry: 2000\n\nid: ${RUN}.${seq}\nevent: frame\ndata: ${sealed(seq)}\n\n`;
	const bytes = new TextEncoder().encode(text);
	let sent = false;
	return {
		status: 200,
		headers: new Headers({ 'Content-Type': 'text/event-stream' }),
		body: {
			getReader: () => ({
				read: async () => {
					if (sent) return { done: true, value: undefined };
					sent = true;
					return { done: false, value: bytes };
				},
				cancel: async () => undefined,
			}),
		} as unknown as ReadableStream<Uint8Array>,
	};
}

const held = (): StreamResponse => ({
	status: 200,
	headers: new Headers(),
	body: {
		getReader: () => ({
			read: () => new Promise(() => {}),
			cancel: async () => undefined,
		}),
	} as unknown as ReadableStream<Uint8Array>,
});

/** A session over the real transport, whose server replays seq `replayed` on every poll. */
function runSession(replayed: number) {
	const fetchImpl = vi.fn(async () =>
		fetchImpl.mock.calls.length > STORM_CAP ? held() : onePoll(replayed),
	);
	const ends: SessionEnd[] = [];
	const states: LiveAnswerState[] = [];
	const session = startLiveAnswerSession({
		answerMessageId: '42',
		sessionKey: {} as CryptoKey,
		endpoint: ENDPOINT,
		startStream: options =>
			startFrameStream({
				...options,
				fetchImpl: fetchImpl as unknown as StreamFetch,
				random: () => 0,
			}),
		onState: state => states.push(state),
		onEnd: end => ends.push(end),
	});
	return { fetchImpl, ends, states, session };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(decryptData).mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a live answer session over the real transport', () => {
	it('asks a bounded number of times for a frame it cannot decrypt, then stops as finished', async () => {
		vi.mocked(decryptData).mockRejectedValue(new Error('OperationError'));
		const h = runSession(0);

		await vi.advanceTimersByTimeAsync(LONG_SPAN_MS);

		expect(h.fetchImpl).toHaveBeenCalledTimes(MAX_STALLED_CONNECTIONS);
		expect(h.ends).toEqual(['finished']);
		expect(h.states.at(-1)?.dropped).toBe(MAX_STALLED_CONNECTIONS);
	});

	it('asks a bounded number of times for a frame the schema refuses, then stops as finished', async () => {
		vi.mocked(decryptData).mockResolvedValue({ ...frame(0, RESET), type: 'token' });
		const h = runSession(0);

		await vi.advanceTimersByTimeAsync(LONG_SPAN_MS);

		expect(h.fetchImpl).toHaveBeenCalledTimes(MAX_STALLED_CONNECTIONS);
		expect(h.ends).toEqual(['finished']);
	});

	it('polls again at once after each poll whose frame was applied', async () => {
		vi.mocked(decryptData).mockImplementation(async (_key, data) => {
			const seq = seqOfSealed(data);
			return frame(seq, seq === 0 ? RESET : STEP);
		});
		// The server sends the frame after the cursor: the n-th poll gets seq n while each applies.
		const fetchImpl = vi.fn(async () => {
			const n = fetchImpl.mock.calls.length - 1;
			return n < 6 ? onePoll(n) : held();
		});
		const states: LiveAnswerState[] = [];
		const session = startLiveAnswerSession({
			answerMessageId: '42',
			sessionKey: {} as CryptoKey,
			endpoint: ENDPOINT,
			startStream: options =>
				startFrameStream({
					...options,
					fetchImpl: fetchImpl as unknown as StreamFetch,
					random: () => 0,
				}),
			onState: state => states.push(state),
			onEnd: () => undefined,
		});

		// Every wait after a poll without progress is at least 1 s; these all come sooner.
		await vi.advanceTimersByTimeAsync(999);

		expect(fetchImpl).toHaveBeenCalledTimes(7);
		expect(states.at(-1)?.nextSeq).toBe(6);
		expect(states.at(-1)?.dropped).toBe(0);
		session.stop();
	});
});

describe('a live answer session', () => {
	/** A session over a stub stream whose events the test hands in directly. */
	function stubSession() {
		let options: FrameStreamOptions | null = null;
		const states: LiveAnswerState[] = [];
		const session = startLiveAnswerSession({
			answerMessageId: '42',
			sessionKey: {} as CryptoKey,
			endpoint: ENDPOINT,
			startStream: given => {
				options = given;
				return { stop: vi.fn(), reconnect: vi.fn() };
			},
			onState: state => states.push(state),
			onEnd: () => undefined,
		});
		const opened = async () => {
			await vi.advanceTimersByTimeAsync(0);
			if (!options) throw new Error('The stream was not started.');
			return options;
		};
		return { session, states, opened };
	}

	it('publishes nothing for a frame whose decryption finishes after it was stopped', async () => {
		let finishDecrypt: (_value: unknown) => void = () => undefined;
		vi.mocked(decryptData).mockReturnValue(
			new Promise(resolve => {
				finishDecrypt = resolve;
			}),
		);
		const h = stubSession();
		const stream = await h.opened();

		const applied = stream.onEvent({ id: `${RUN}.0`, data: sealed(0) });
		h.session.stop();
		finishDecrypt(frame(0, RESET));
		await applied;

		expect(h.states).toEqual([]);
	});

	it('drops data that is not a sealed frame without trying to decrypt it', async () => {
		const h = stubSession();
		const stream = await h.opened();

		await stream.onEvent({ id: `${RUN}.0`, data: 'not a sealed frame' });

		expect(decryptData).not.toHaveBeenCalled();
		expect(h.states.at(-1)?.dropped).toBe(1);
	});
});
