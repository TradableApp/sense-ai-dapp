import * as Sentry from '@sentry/react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptData } from '@/lib/crypto';
import type { FrameStreamOptions } from '@/lib/liveReasoning/frameTransport';
import { forgetLiveReports } from '@/lib/liveReasoning/liveReport';
import { FOLLOW_MAX_AGE_MS } from '@/lib/liveReasoning/pendingAnswers';
import streamProof from '@/lib/liveReasoning/streamProof';
import { importVectorKey } from '@/lib/liveReasoning/vector.testdata';

import useLiveReasoning from './useLiveReasoning';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

const endpoint = vi.hoisted(() => ({
	value: { url: 'https://stream.example', mode: 'sse' } as { url: string; mode: string } | null,
}));
vi.mock('@/config/reasoningStream', () => ({ default: () => endpoint.value }));

interface StartedStream {
	options: FrameStreamOptions;
	stop: ReturnType<typeof vi.fn>;
	reconnect: ReturnType<typeof vi.fn>;
	wake: ReturnType<typeof vi.fn>;
}
const streams = vi.hoisted(() => ({ started: [] as StartedStream[] }));
vi.mock('@/lib/liveReasoning/frameTransport', () => ({
	startFrameStream: (options: FrameStreamOptions) => {
		const stream = { options, stop: vi.fn(), reconnect: vi.fn(), wake: vi.fn() };
		streams.started.push(stream);
		return stream;
	},
}));

const RUN = '0123456789abcdef';
const OWNER = '0x00000000000000000000000000000000000000aa';

const user = (id: string, extra: object = {}) => ({
	id,
	role: 'user',
	content: 'q',
	createdAt: Date.now(),
	...extra,
});
const placeholder = (id: string, extra: object = {}) => ({
	id,
	role: 'assistant',
	content: null,
	createdAt: Date.now(),
	...extra,
});

type Body = { type: string; data: unknown };
const frame = (seq: number, body: Body, answerMessageId = '42', run = RUN) => ({
	v: 1,
	answerMessageId,
	run,
	seq,
	replica: 'deadbeef',
	...body,
});
const RESET = { type: 'reset', data: { reason: 'start' } };
const STEP = { type: 'step', data: { attempt: 1, title: 'Reading', description: 'Read it.' } };
const ANSWER = { type: 'answer', data: { text: 'Prices rose.', answerMessageCID: 'bafy1' } };
const ANSWERED = { type: 'done', data: { outcome: 'answered' } };

let sessionKey: CryptoKey;

/** Seals a frame with the session key and hands it to the stream as the server would. */
async function push(stream: StartedStream, value: ReturnType<typeof frame>, key = sessionKey) {
	const data = await encryptData(key, value);
	act(() => {
		stream.options.onEvent({ id: `${value.run}.${value.seq}`, data });
	});
}

interface Props {
	messages: object[];
	sessionKey: CryptoKey | null;
	ownerAddress: string | null;
}

function mount(messages: object[], key: CryptoKey | null = sessionKey) {
	return renderHook((props: Props) => useLiveReasoning(props), {
		initialProps: { messages, sessionKey: key, ownerAddress: OWNER },
	});
}

const streamFor = (id: string) =>
	streams.started.find(s => s.options.url.endsWith(`/stream/${id}`)) as StartedStream;

beforeEach(async () => {
	vi.clearAllMocks();
	streams.started = [];
	endpoint.value = { url: 'https://stream.example', mode: 'sse' };
	forgetLiveReports();
	sessionKey = await importVectorKey();
});

afterEach(cleanup);

describe('useLiveReasoning', () => {
	it('starts a stream for a pending answer, with its proof in the options and not in the URL', async () => {
		mount([user('41'), placeholder('42', { parentId: '41' })]);

		await waitFor(() => expect(streams.started).toHaveLength(1));
		const [{ options }] = streams.started;
		expect(options.url).toBe('https://stream.example/stream/42');
		expect(options.proof).toBe(await streamProof(sessionKey, '42'));
		expect(options.url).not.toContain(options.proof);
	});

	it('starts nothing when the stream setting is unset, and shows nothing', async () => {
		endpoint.value = null;
		const { result } = mount([user('41'), placeholder('42')]);

		await act(async () => {});

		expect(streams.started).toHaveLength(0);
		expect(result.current.viewFor('42')).toBeUndefined();
	});

	it('opens no stream for an answer whose prompt is older than the stream can still exist', async () => {
		const tooOld = Date.now() - FOLLOW_MAX_AGE_MS - 1_000;
		mount([
			user('41', { createdAt: tooOld }),
			placeholder('42', { createdAt: tooOld }),
			user('43', { status: 'pending', answerMessageId: '44', createdAt: tooOld }),
		]);

		await act(async () => {});

		expect(streams.started).toHaveLength(0);
	});

	it('starts nothing without a session key', async () => {
		mount([user('41'), placeholder('42')], null);

		await act(async () => {});

		expect(streams.started).toHaveLength(0);
	});

	it('shows the steps of the frames it receives', async () => {
		const { result } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));

		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, STEP));

		await waitFor(() => expect(result.current.viewFor('42')?.steps).toHaveLength(1));
		expect(result.current.viewFor('42')?.steps[0]).toEqual({
			title: 'Reading',
			description: 'Read it.',
			attempt: 1,
		});
	});

	it('drops and counts a frame that fails decryption or the schema, and never shows it', async () => {
		const otherKey = await window.crypto.subtle.generateKey(
			{ name: 'AES-GCM', length: 256 },
			true,
			['encrypt', 'decrypt'],
		);
		const { result } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		const stream = streamFor('42');
		await push(stream, frame(0, RESET));

		await push(stream, frame(1, STEP), otherKey);
		const badSchema = await encryptData(sessionKey, { ...frame(1, STEP), type: 'token' });
		act(() => {
			stream.options.onEvent({ id: `${RUN}.1`, data: badSchema });
		});
		act(() => {
			stream.options.onEvent({ id: `${RUN}.1`, data: 'not a sealed frame' });
		});

		await waitFor(() => expect(result.current.viewFor('42')?.dropped).toBe(3));
		expect(result.current.viewFor('42')?.steps).toEqual([]);
	});

	it('rejects a frame sealed for another answer of the same wallet', async () => {
		const { result } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));

		await push(streamFor('42'), frame(1, STEP, '43'));

		await waitFor(() => expect(result.current.viewFor('42')?.dropped).toBe(1));
		expect(result.current.viewFor('42')?.steps).toEqual([]);
	});

	it('reconnects with no cursor when a frame of another run arrives', async () => {
		mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));

		await push(streamFor('42'), frame(3, STEP, '42', 'fedcba9876543210'));

		await waitFor(() => expect(streamFor('42').reconnect).toHaveBeenCalledWith(true));
	});

	it('stops when the stored answer lands, clears the overlay and reports a difference once', async () => {
		const { result, rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		const stream = streamFor('42');
		await push(stream, frame(0, RESET));
		await push(stream, frame(1, STEP));
		await push(stream, frame(2, ANSWER));
		await push(stream, frame(3, ANSWERED));
		await waitFor(() => expect(result.current.viewFor('42')?.outcome).toBe('answered'));

		rerender({
			messages: [user('41'), placeholder('42', { content: 'Prices fell.', reasoning: [] })],
			sessionKey,
			ownerAddress: OWNER,
		});

		expect(stream.stop).toHaveBeenCalled();
		expect(result.current.viewFor('42')).toBeUndefined();
		expect(result.current.hadProvisionalAnswer('42')).toBe(true);
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		expect(vi.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
			tags: { check: 'live-reasoning', mismatch: 'step-count' },
		});
	});

	it('marks the time from the provisional answer to the stored one', async () => {
		const mark = vi.spyOn(performance, 'mark');
		const measure = vi.spyOn(performance, 'measure');
		const { result, rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, ANSWER));
		await waitFor(() => expect(result.current.viewFor('42')?.answer).not.toBeNull());

		rerender({
			messages: [user('41'), placeholder('42', { content: 'Prices rose.' })],
			sessionKey,
			ownerAddress: OWNER,
		});

		expect(mark).toHaveBeenCalledWith('live-answer:42');
		expect(mark).toHaveBeenCalledWith('stored-answer:42');
		expect(measure).toHaveBeenCalledWith(
			'live-answer-lead:42',
			'live-answer:42',
			'stored-answer:42',
		);
	});

	it('stops and clears when the placeholder disappears (cancelled or refunded)', async () => {
		const { result, rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, STEP));
		await waitFor(() => expect(result.current.viewFor('42')?.steps).toHaveLength(1));

		rerender({ messages: [user('41')], sessionKey, ownerAddress: OWNER });

		expect(streamFor('42').stop).toHaveBeenCalled();
		expect(result.current.viewFor('42')).toBeUndefined();
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it('stops when another conversation is opened', async () => {
		const { rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));

		rerender({
			messages: [user('7'), { id: '8', role: 'assistant', content: 'a' }],
			sessionKey,
			ownerAddress: OWNER,
		});

		expect(streamFor('42').stop).toHaveBeenCalled();
	});

	it('stops when unmounted, and nothing live survives a remount', async () => {
		const first = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, STEP));
		await waitFor(() => expect(first.result.current.viewFor('42')?.steps).toHaveLength(1));

		first.unmount();
		expect(streams.started[0].stop).toHaveBeenCalled();

		const second = mount([user('41'), placeholder('42')]);
		expect(second.result.current.viewFor('42')).toBeUndefined();
		await waitFor(() => expect(streams.started).toHaveLength(2));
	});

	it('clears the overlay and starts again when the wallet or session changes', async () => {
		const { result, rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, STEP));
		await waitFor(() => expect(result.current.viewFor('42')?.steps).toHaveLength(1));
		const nextKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
			'encrypt',
			'decrypt',
		]);

		rerender({
			messages: [user('41'), placeholder('42')],
			sessionKey: nextKey,
			ownerAddress: OWNER,
		});

		expect(streams.started[0].stop).toHaveBeenCalled();
		expect(result.current.viewFor('42')).toBeUndefined();
		await waitFor(() => expect(streams.started).toHaveLength(2));
		expect(streams.started[1].options.proof).toBe(await streamProof(nextKey, '42'));
	});

	it('gives a second pending answer in the same conversation its own stream', async () => {
		mount([
			user('41'),
			placeholder('42', { parentId: '41' }),
			placeholder('44', { parentId: '41' }),
		]);

		await waitFor(() => expect(streams.started).toHaveLength(2));
		expect(streams.started.map(s => s.options.url).sort()).toEqual([
			'https://stream.example/stream/42',
			'https://stream.example/stream/44',
		]);
	});

	it('streams the answer of a prompt another device sent, known only from the sync', async () => {
		mount([user('41', { status: 'pending', answerMessageId: '42' })]);

		await waitFor(() => expect(streams.started).toHaveLength(1));
		expect(streams.started[0].options.url).toBe('https://stream.example/stream/42');
	});

	it('stops for good and clears the overlay when the run is abandoned', async () => {
		const { result } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		await push(streamFor('42'), frame(0, RESET));
		await push(streamFor('42'), frame(1, STEP));

		await push(streamFor('42'), frame(2, { type: 'done', data: { outcome: 'abandoned' } }));

		await waitFor(() => expect(streamFor('42').stop).toHaveBeenCalled());
		expect(result.current.viewFor('42')).toBeUndefined();
	});

	it('never puts the proof in a log line or a report', async () => {
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
			vi.spyOn(console, level).mockImplementation(() => {}),
		);
		const { rerender } = mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		const stream = streamFor('42');
		act(() => {
			stream.options.onEvent({ id: `${RUN}.0`, data: 'x.y' });
		});
		act(() => stream.options.onStop('proof-refused'));
		rerender({ messages: [user('41')], sessionKey, ownerAddress: OWNER });

		const proof = await streamProof(sessionKey, '42');
		const everything = JSON.stringify([
			...spies.flatMap(spy => spy.mock.calls),
			vi.mocked(Sentry.captureException).mock.calls.map(([e, ctx]) => [String(e), ctx]),
		]);
		expect(everything).not.toContain(proof);
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		spies.forEach(spy => spy.mockRestore());
	});

	it('tells the stream when the tab is hidden, and wakes it when the tab is shown again', async () => {
		const visibility = vi.spyOn(document, 'visibilityState', 'get');
		mount([user('41'), placeholder('42')]);
		await waitFor(() => expect(streams.started).toHaveLength(1));
		const stream = streamFor('42');

		visibility.mockReturnValue('hidden');
		expect(stream.options.isHidden?.()).toBe(true);
		act(() => {
			document.dispatchEvent(new Event('visibilitychange'));
		});
		expect(stream.wake).not.toHaveBeenCalled();

		visibility.mockReturnValue('visible');
		expect(stream.options.isHidden?.()).toBe(false);
		act(() => {
			document.dispatchEvent(new Event('visibilitychange'));
		});
		expect(stream.wake).toHaveBeenCalledTimes(1);
		visibility.mockRestore();
	});
});
