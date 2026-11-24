import { describe, expect, it } from 'vitest';

import type { Frame } from './contract';
import {
	applyFrame,
	checkGap,
	cursorOf,
	dropFrame,
	GAP_WAIT_MS,
	initialLiveState,
	type LiveAnswerState,
	MAX_HELD_FRAMES,
	MAX_SOURCES_PER_ATTEMPT,
} from './liveReducer';

const ID = '42';
const RUN_A = '0123456789abcdef';
const RUN_B = 'fedcba9876543210';

type FrameBody = Pick<Frame, 'type' | 'data'>;

const frame = (seq: number, body: FrameBody, run = RUN_A, answerMessageId = ID): Frame =>
	({ v: 1, answerMessageId, run, seq, replica: 'deadbeef', ...body } as Frame);

const reset = (run = RUN_A): Frame => frame(0, { type: 'reset', data: { reason: 'start' } }, run);
const step = (seq: number, title: string, attemptNo = 1, run = RUN_A): Frame =>
	frame(seq, { type: 'step', data: { attempt: attemptNo, title, description: `${title}.` } }, run);

/** Applies frames in order, each with its own SSE id, at time `now`. */
function applyAll(frames: Frame[], start = initialLiveState(ID), now = 0) {
	return frames.reduce(({ state }, f) => applyFrame(state, f, { run: f.run, seq: f.seq }, now), {
		state: start,
		effect: 'none' as const,
	} as ReturnType<typeof applyFrame>);
}

const titles = (state: LiveAnswerState) => state.steps.map(s => s.title);

describe('the live reducer', () => {
	it('starts a run on its reset and shows steps in seq order', () => {
		const { state } = applyAll([reset(), step(1, 'one'), step(2, 'two')]);

		expect(state.run).toBe(RUN_A);
		expect(titles(state)).toEqual(['one', 'two']);
		expect(cursorOf(state)).toBe(`${RUN_A}.2`);
	});

	it('clears everything shown when a new run starts with its reset', () => {
		const first = applyAll([reset(), step(1, 'old')]).state;

		const { state, effect } = applyAll([reset(RUN_B), step(1, 'new', 1, RUN_B)], first);

		expect(effect).toBe('none');
		expect(titles(state)).toEqual(['new']);
		expect(state.run).toBe(RUN_B);
	});

	it('drops a frame of another run that is not its reset, and asks for a fresh connection', () => {
		const first = applyAll([reset(), step(1, 'one')]).state;

		const { state, effect } = applyFrame(
			first,
			step(2, 'stray', 1, RUN_B),
			{ run: RUN_B, seq: 2 },
			0,
		);

		expect(effect).toBe('reconnect-fresh');
		expect(titles(state)).toEqual(['one']);
		expect(state.dropped).toBe(1);
	});

	it('ignores a duplicate (run, seq)', () => {
		const once = applyAll([reset(), step(1, 'one')]).state;

		const { state } = applyFrame(once, step(1, 'one'), { run: RUN_A, seq: 1 }, 0);

		expect(titles(state)).toEqual(['one']);
	});

	it('holds a frame after a gap and applies it once the gap is filled', () => {
		const started = applyAll([reset()]).state;
		const held = applyFrame(started, step(2, 'two'), { run: RUN_A, seq: 2 }, 100).state;

		expect(titles(held)).toEqual([]);

		const { state } = applyFrame(held, step(1, 'one'), { run: RUN_A, seq: 1 }, 200);

		expect(titles(state)).toEqual(['one', 'two']);
		expect(state.gapSince).toBeNull();
	});

	it('reconnects from the last contiguous frame when a gap is not filled within 5 s', () => {
		const started = applyAll([reset(), step(1, 'one')]).state;
		const held = applyFrame(started, step(3, 'three'), { run: RUN_A, seq: 3 }, 1_000).state;

		// The gap opened at t = 1 000 ms; GAP_WAIT_MS (5 000 ms) later, at t = 6 000, it is given up.
		expect(checkGap(held, 1_000 + GAP_WAIT_MS - 1).effect).toBe('none');
		const { state, effect } = checkGap(held, 1_000 + GAP_WAIT_MS);

		expect(GAP_WAIT_MS).toBe(5_000);
		expect(effect).toBe('reconnect-from-cursor');
		expect(state.held).toEqual([]);
		expect(cursorOf(state)).toBe(`${RUN_A}.1`);
	});

	it('reconnects at once when more frames are held than the limit', () => {
		const started = applyAll([reset()]).state;
		const filled = Array.from({ length: MAX_HELD_FRAMES }, (_, i) => step(i + 2, `s${i}`)).reduce(
			(s, f) => applyFrame(s, f, { run: RUN_A, seq: f.seq }, 0).state,
			started,
		);

		const { effect } = applyFrame(
			filled,
			step(MAX_HELD_FRAMES + 2, 'over'),
			{
				run: RUN_A,
				seq: MAX_HELD_FRAMES + 2,
			},
			0,
		);

		expect(MAX_HELD_FRAMES).toBe(64);
		expect(effect).toBe('reconnect-from-cursor');
	});

	it('rejects a frame that names another answer id', () => {
		const started = applyAll([reset()]).state;
		const other = frame(
			1,
			{ type: 'step', data: { attempt: 1, title: 'x', description: 'y' } },
			RUN_A,
			'43',
		);

		const { state } = applyFrame(started, other, { run: RUN_A, seq: 1 }, 0);

		expect(titles(state)).toEqual([]);
		expect(state.dropped).toBe(1);
	});

	it('rejects a frame whose run or seq differs from its SSE id', () => {
		const started = applyAll([reset()]).state;

		const wrongSeq = applyFrame(started, step(1, 'x'), { run: RUN_A, seq: 2 }, 0).state;
		const wrongRun = applyFrame(started, step(1, 'x'), { run: RUN_B, seq: 1 }, 0).state;

		expect(titles(wrongSeq)).toEqual([]);
		expect(titles(wrongRun)).toEqual([]);
		expect(wrongSeq.dropped + wrongRun.dropped).toBe(2);
	});

	it('counts a frame dropped for failing decryption or the schema', () => {
		expect(dropFrame(initialLiveState(ID)).dropped).toBe(1);
	});

	it('keeps earlier steps on a fallback attempt and tags each step and source with its attempt', () => {
		const { state } = applyAll([
			reset(),
			frame(1, {
				type: 'sources',
				data: { attempt: 1, sources: [{ title: 'A', url: 'https://a.example' }] },
			}),
			step(2, 'first try'),
			frame(3, { type: 'attempt', data: { attempt: 2 } }),
			step(4, 'second try', 2),
		]);

		expect(state.attempt).toBe(2);
		expect(state.steps).toEqual([
			{ title: 'first try', description: 'first try.', attempt: 1 },
			{ title: 'second try', description: 'second try.', attempt: 2 },
		]);
		expect(state.sources).toEqual([{ title: 'A', url: 'https://a.example', attempt: 1 }]);
	});

	it('keeps the provisional answer after done answered', () => {
		const { state } = applyAll([
			reset(),
			step(1, 'one'),
			frame(2, {
				type: 'answer',
				data: { text: 'Up.', answerMessageCID: 'bafy1', reasoningDuration: 3 },
			}),
			frame(3, { type: 'done', data: { outcome: 'answered' } }),
		]);

		expect(state.answer).toEqual({ text: 'Up.', answerMessageCID: 'bafy1', reasoningDuration: 3 });
		expect(state.outcome).toBe('answered');
		expect(titles(state)).toEqual(['one']);
	});

	it('clears what was shown after done abandoned', () => {
		const { state } = applyAll([
			reset(),
			step(1, 'one'),
			frame(2, { type: 'done', data: { outcome: 'abandoned' } }),
		]);

		expect(state.outcome).toBe('abandoned');
		expect(state.steps).toEqual([]);
		expect(state.answer).toBeNull();
	});

	it('keeps the steps shown after done interrupted, for the retry to replace', () => {
		const { state } = applyAll([
			reset(),
			step(1, 'one'),
			frame(2, { type: 'done', data: { outcome: 'interrupted' } }),
		]);

		expect(state.outcome).toBe('interrupted');
		expect(titles(state)).toEqual(['one']);
	});

	it('never changes the state it is given', () => {
		const started = applyAll([reset()]).state;
		const snapshot = JSON.stringify(started);

		applyFrame(started, step(1, 'one'), { run: RUN_A, seq: 1 }, 0);
		applyFrame(started, step(3, 'three'), { run: RUN_A, seq: 3 }, 0);

		expect(JSON.stringify(started)).toBe(snapshot);
	});

	it('takes a reset of another run only at seq 0: a later one is dropped and asks for a fresh connection', () => {
		const first = applyAll([reset(), step(1, 'one')]).state;
		const lateReset = frame(3, { type: 'reset', data: { reason: 'retry' } }, RUN_B);

		const { state, effect } = applyFrame(first, lateReset, { run: RUN_B, seq: 3 }, 0);

		expect(effect).toBe('reconnect-fresh');
		expect(state.run).toBe(RUN_A);
		expect(titles(state)).toEqual(['one']);
		expect(state.dropped).toBe(1);
	});

	it('keeps the dropped count across a new run', () => {
		const first = dropFrame(applyAll([reset()]).state);

		const { state } = applyAll([reset(RUN_B)], first);

		expect(state.run).toBe(RUN_B);
		expect(state.dropped).toBe(1);
	});

	it('applies held frames in seq order, whatever order they arrived in', () => {
		const started = applyAll([reset()]).state;

		const { state } = applyAll([step(3, 'three'), step(2, 'two'), step(1, 'one')], started);

		expect(titles(state)).toEqual(['one', 'two', 'three']);
		expect(state.held).toEqual([]);
		expect(state.gapSince).toBeNull();
		expect(cursorOf(state)).toBe(`${RUN_A}.3`);
	});

	it('holds a frame received twice after a gap only once', () => {
		const started = applyAll([reset()]).state;

		const held = applyAll([step(2, 'two'), step(2, 'two')], started).state;
		const { state } = applyFrame(held, step(1, 'one'), { run: RUN_A, seq: 1 }, 0);

		expect(held.held).toHaveLength(1);
		expect(titles(state)).toEqual(['one', 'two']);
	});

	it('never moves the attempt backwards', () => {
		const attemptFrame = (seq: number, n: number) =>
			frame(seq, { type: 'attempt', data: { attempt: n } });

		const { state } = applyAll([reset(), attemptFrame(1, 3), attemptFrame(2, 2)]);

		expect(state.attempt).toBe(3);
		expect(state.nextSeq).toBe(3);
	});

	it("shows at most the contract's 64 steps per attempt, and still moves the cursor past the rest", () => {
		const steps = Array.from({ length: 70 }, (_, i) => step(i + 1, `s${i + 1}`));
		const fallback = step(71, 'fallback', 2);

		const { state } = applyAll([reset(), ...steps, fallback]);

		expect(state.steps.filter(s => s.attempt === 1)).toHaveLength(64);
		expect(titles(state).at(63)).toBe('s64');
		expect(titles(state).at(-1)).toBe('fallback');
		expect(cursorOf(state)).toBe(`${RUN_A}.71`);
	});

	it('shows at most MAX_SOURCES_PER_ATTEMPT sources per attempt, however many frames carry them', () => {
		const sourcesFrame = (seq: number, attemptNo: number, count: number) =>
			frame(seq, {
				type: 'sources',
				data: {
					attempt: attemptNo,
					sources: Array.from({ length: count }, (_, i) => ({
						title: `t${seq}-${i}`,
						url: `https://example.com/${seq}/${i}`,
					})),
				},
			});

		const { state } = applyAll([
			reset(),
			sourcesFrame(1, 1, 15),
			sourcesFrame(2, 1, 15),
			sourcesFrame(3, 1, 15),
			sourcesFrame(4, 2, 15),
		]);

		expect(state.sources.filter(s => s.attempt === 1)).toHaveLength(MAX_SOURCES_PER_ATTEMPT);
		expect(state.sources.filter(s => s.attempt === 2)).toHaveLength(15);
		expect(state.sources[0].title).toBe('t1-0');
		expect(cursorOf(state)).toBe(`${RUN_A}.4`);
		expect(MAX_SOURCES_PER_ATTEMPT).toBe(20);
	});
});
