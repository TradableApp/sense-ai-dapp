import * as Sentry from '@sentry/react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentsSwitchedOffBanner from '@/components/PaymentsSwitchedOffBanner';
import usePromptsSwitch from '@/hooks/usePromptsSwitch';
import { savedSwitchKey, switchCopy } from '@/lib/promptsSwitch';
import {
	listenerFails,
	onSnapshot,
	resetSwitchStub,
	serverSays,
	stub,
	SWITCH_DOC_ID,
} from '@/test/promptsSwitchStub';

import {
	resetPromptsSwitchSource,
	SWITCH_FIRST_ANSWER_MS,
	SWITCH_RETRY_MS,
} from './promptsSwitchSource';

vi.mock(
	'firebase/firestore',
	async () => (await import('@/test/promptsSwitchStub')).firestoreModule,
);
vi.mock('@/config/firebase', async () => (await import('@/test/promptsSwitchStub')).firebaseModule);
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));

const reports = () => vi.mocked(Sentry.captureException).mock.calls;
const failures = () =>
	reports().map(([, context]) => (context as { tags: Record<string, string> }).tags.failure);
const saved = () => localStorage.getItem(savedSwitchKey(SWITCH_DOC_ID));

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	resetSwitchStub();
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	localStorage.clear();
	resetPromptsSwitchSource();
});

afterEach(() => {
	cleanup();
	resetPromptsSwitchSource();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('a listener that cannot read the switch is reported', () => {
	it('once per error code, however often it retries, with the code and never the message', () => {
		renderHook(() => usePromptsSwitch());

		[1, 2, 3].forEach(() => {
			listenerFails('permission-denied');
			act(() => {
				vi.advanceTimersByTime(SWITCH_RETRY_MS);
			});
		});

		expect(onSnapshot).toHaveBeenCalledTimes(4);
		expect(failures()).toEqual(['listener-permission-denied']);
		const [error, context] = reports()[0];
		expect(context).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ check: 'prompts-switch' }),
				fingerprint: expect.arrayContaining(['permission-denied']),
			}),
		);
		expect(JSON.stringify(context)).not.toMatch(/insufficient/i);
		expect((error as Error).message).not.toMatch(/insufficient/i);
	});

	it('again for a different code', () => {
		renderHook(() => usePromptsSwitch());

		listenerFails('permission-denied');
		act(() => {
			vi.advanceTimersByTime(SWITCH_RETRY_MS);
		});
		listenerFails('unavailable');

		expect(failures()).toEqual(['listener-permission-denied', 'listener-unavailable']);
	});

	it('once when Firestore did not start', () => {
		stub.db = undefined;

		renderHook(() => usePromptsSwitch());
		renderHook(() => usePromptsSwitch());

		expect(onSnapshot).not.toHaveBeenCalled();
		expect(failures()).toEqual(['no-firestore']);
	});

	it('once when no server answer has come within the wait while the browser is online', () => {
		renderHook(() => usePromptsSwitch());
		// A cached answer is not the server's.
		serverSays({ closed: false }, { fromCache: true });

		act(() => {
			vi.advanceTimersByTime(SWITCH_FIRST_ANSWER_MS * 3);
		});

		expect(failures()).toEqual(['no-server-answer']);
	});

	it('not when the server answers in time', () => {
		renderHook(() => usePromptsSwitch());
		act(() => {
			vi.advanceTimersByTime(SWITCH_FIRST_ANSWER_MS - 1000);
		});
		serverSays({ closed: false });

		act(() => {
			vi.advanceTimersByTime(SWITCH_FIRST_ANSWER_MS * 2);
		});

		expect(reports()).toHaveLength(0);
	});

	it('not when the browser is offline', () => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		renderHook(() => usePromptsSwitch());

		act(() => {
			vi.advanceTimersByTime(SWITCH_FIRST_ANSWER_MS * 2);
		});

		expect(reports()).toHaveLength(0);
	});
});

describe('the retry', () => {
	it('is not skipped by a new reader while it is pending', () => {
		renderHook(() => usePromptsSwitch());
		listenerFails();

		renderHook(() => usePromptsSwitch());
		expect(onSnapshot).toHaveBeenCalledTimes(1);

		act(() => {
			vi.advanceTimersByTime(SWITCH_RETRY_MS);
		});
		expect(onSnapshot).toHaveBeenCalledTimes(2);
	});

	it('leaves no timer behind once the last reader is gone', () => {
		const { unmount } = renderHook(() => usePromptsSwitch());
		listenerFails();

		unmount();

		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('a malformed document when reporting fails', () => {
	it('still closes and is saved', () => {
		vi.mocked(Sentry.captureException).mockImplementation(() => {
			throw new Error('reporting is down');
		});
		const { result } = renderHook(() => usePromptsSwitch());
		serverSays({ closed: false });

		serverSays({ closed: 'yes' });

		expect(result.current).toEqual({ status: 'closed', wording: 'generic' });
		expect(JSON.parse(saved() ?? 'null')).toEqual({ closed: true, wording: 'generic' });
	});
});

describe('faults in the document', () => {
	it('are reported once per kind', () => {
		renderHook(() => usePromptsSwitch());

		serverSays({ closed: 'yes' });
		serverSays({ closed: 1 });
		serverSays({ closed: true, reason: 'migration' });
		serverSays({ closed: true, reason: 'other-new-reason' });

		const kinds = reports().map(
			([, context]) => (context as { tags: Record<string, string> }).tags.fault,
		);
		expect(kinds).toEqual(['malformed', 'unknown-reason']);
	});
});

describe('the store', () => {
	it('passes a change of wording while closed to a mounted reader', () => {
		render(<PaymentsSwitchedOffBanner />);
		serverSays({ closed: true, reason: 'maintenance' });
		expect(screen.getByRole('alert').textContent).toContain(switchCopy('maintenance').title);

		serverSays({ closed: true, reason: 'pair-retired' });

		expect(screen.getByRole('alert').textContent).toContain(switchCopy('pair-retired').title);
	});

	it('reads a saved value without closed: true as nothing saved', () => {
		localStorage.setItem(
			savedSwitchKey(SWITCH_DOC_ID),
			JSON.stringify({ closed: 'true', wording: 'incident' }),
		);

		const { result } = renderHook(() => usePromptsSwitch());

		expect(result.current).toEqual({ status: 'unknown' });
	});
});
