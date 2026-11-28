import * as Sentry from '@sentry/react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentsSwitchedOffBanner from '@/components/PaymentsSwitchedOffBanner';
import usePaymentGate from '@/hooks/usePaymentGate';
import { savedSwitchKey, switchCopy } from '@/lib/promptsSwitch';
import { resetPromptsSwitchSource, SWITCH_RETRY_MS } from '@/lib/promptsSwitchSource';

import usePromptsSwitch from './usePromptsSwitch';

// Firestore is never reached: the listener is a stand-in the test drives.
const onSnapshot = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', () => ({
	doc: vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` })),
	onSnapshot,
}));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/config/feeToken', () => ({ FEE_TOKEN: { symbol: 'PTS' } }));
vi.mock('@/hooks/useFeeTokenCheck', () => ({
	default: () => ({ verdict: 'ok', blocks: () => false }),
}));
// The oracle key check has no answer here, so it stops nothing; its own tests drive it.
vi.mock('@/hooks/useOracleKeyCheck', () => ({ default: () => 'unknown' }));

const AGENT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const DOC_ID = `84532_${AGENT.toLowerCase()}`;
const ABSENT = Symbol('absent');

type Listener = {
	ref: { path: string };
	options: unknown;
	next: (_snapshot: unknown) => void;
	error: (_error: unknown) => void;
};

const unsubscribe = vi.fn();
let listeners: Listener[] = [];
const latest = () => {
	const listener = listeners.at(-1);
	if (!listener) throw new Error('nothing is listening');
	return listener;
};

function serverSays(data: unknown, { fromCache = false } = {}) {
	act(() => {
		latest().next({
			exists: () => data !== ABSENT,
			data: () => (data === ABSENT ? undefined : data),
			metadata: { fromCache },
		});
	});
}

function listenerFails() {
	act(() => {
		latest().error(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'x' }));
	});
}

const saved = () => localStorage.getItem(savedSwitchKey(DOC_ID));

beforeEach(() => {
	vi.clearAllMocks();
	listeners = [];
	onSnapshot.mockImplementation(
		(ref: Listener['ref'], options: unknown, next: Listener['next'], error: Listener['error']) => {
			listeners.push({ ref, options, next, error });
			return unsubscribe;
		},
	);
	vi.stubEnv('VITE_CHAIN_ID', '84532');
	vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
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

describe('the prompts switch listener', () => {
	it('listens to the document for this chain and agent, server answers included', () => {
		renderHook(() => usePromptsSwitch());

		expect(onSnapshot).toHaveBeenCalledTimes(1);
		expect(latest().ref.path).toBe(`senseai_prompts_switch/${DOC_ID}`);
		expect(latest().options).toEqual({ includeMetadataChanges: true });
	});

	it('is one listener however many hooks are mounted, and stops when the last one goes', () => {
		const hooks = [1, 2, 3].map(() => renderHook(() => usePromptsSwitch()));

		expect(onSnapshot).toHaveBeenCalledTimes(1);

		hooks.forEach(hook => hook.unmount());
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('is unknown before the server has answered and nothing was saved, and stops nothing', () => {
		const { result } = renderHook(() => usePaymentGate());

		expect(result.current.state.prompts).toEqual({ status: 'unknown' });
		expect(result.current.blocks('prompt')).toBe(false);
	});

	it('listens to nothing and is open when the build names no chain or agent', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');
		localStorage.setItem(
			savedSwitchKey(DOC_ID),
			JSON.stringify({ closed: true, wording: 'incident' }),
		);

		const { result } = renderHook(() => usePromptsSwitch());

		expect(onSnapshot).not.toHaveBeenCalled();
		expect(result.current).toEqual({ status: 'open' });
	});
});

describe('what the switch holds when the server cannot be heard', () => {
	it('a confirmed closure is kept through a listener error', () => {
		const { result } = renderHook(() => usePromptsSwitch());
		serverSays({ closed: true, reason: 'maintenance' });

		listenerFails();

		expect(result.current).toEqual({ status: 'closed', wording: 'maintenance' });
	});

	it('a confirmed open is kept through a listener error', () => {
		const { result } = renderHook(() => usePromptsSwitch());
		serverSays({ closed: false });

		listenerFails();

		expect(result.current).toEqual({ status: 'open' });
	});

	it('a cached answer changes nothing', () => {
		const { result } = renderHook(() => usePromptsSwitch());
		serverSays({ closed: true, reason: 'incident' });

		serverSays({ closed: false }, { fromCache: true });
		serverSays(ABSENT, { fromCache: true });

		expect(result.current).toEqual({ status: 'closed', wording: 'incident' });
	});

	it('a saved closure survives a reload whose listener only errors', () => {
		const first = renderHook(() => usePromptsSwitch());
		serverSays({ closed: true, reason: 'pair-retired' });
		first.unmount();
		// A reload: the module starts afresh, the browser's storage stays.
		resetPromptsSwitchSource();

		const { result } = renderHook(() => usePromptsSwitch());
		listenerFails();

		expect(result.current).toEqual({ status: 'closed', wording: 'pair-retired' });
	});

	it('a saved closure survives a reload whose answers are only cached', () => {
		localStorage.setItem(
			savedSwitchKey(DOC_ID),
			JSON.stringify({ closed: true, wording: 'maintenance' }),
		);

		const { result } = renderHook(() => usePromptsSwitch());
		serverSays({ closed: false }, { fromCache: true });

		expect(result.current).toEqual({ status: 'closed', wording: 'maintenance' });
	});

	it('a server-confirmed open clears the saved closure', () => {
		localStorage.setItem(
			savedSwitchKey(DOC_ID),
			JSON.stringify({ closed: true, wording: 'maintenance' }),
		);
		const { result } = renderHook(() => usePromptsSwitch());

		serverSays(ABSENT);

		expect(result.current).toEqual({ status: 'open' });
		expect(saved()).toBeNull();
	});

	it('a confirmed closure is saved', () => {
		renderHook(() => usePromptsSwitch());

		serverSays({ closed: true, reason: 'incident' });

		expect(JSON.parse(saved() ?? 'null')).toEqual({ closed: true, wording: 'incident' });
	});

	it('works when the browser refuses storage', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const { result } = renderHook(() => usePromptsSwitch());

		serverSays({ closed: true, reason: 'incident' });

		expect(result.current).toEqual({ status: 'closed', wording: 'incident' });
	});

	it('listens again after an error, while something still reads it', () => {
		vi.useFakeTimers();
		renderHook(() => usePromptsSwitch());
		listenerFails();

		act(() => {
			vi.advanceTimersByTime(SWITCH_RETRY_MS);
		});

		expect(onSnapshot).toHaveBeenCalledTimes(2);
	});
});

describe('a document that cannot be read as the switch', () => {
	it('closes, in generic words, and is reported once per page load by its shape only', () => {
		const { result } = renderHook(() => usePromptsSwitch());

		serverSays({ closed: 'yes', reason: 'secret words' });
		serverSays({ closed: 'yes', reason: 'secret words', again: true });

		expect(result.current).toEqual({ status: 'closed', wording: 'generic' });
		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(context).toEqual(
			expect.objectContaining({
				tags: expect.objectContaining({ check: 'prompts-switch', fault: 'malformed' }),
			}),
		);
		expect(String((error as Error).message)).not.toContain('secret');
		expect(JSON.stringify(context)).not.toContain('secret');
	});
});

describe('a mounted page while the switch changes', () => {
	function Probe() {
		const gate = usePaymentGate();
		return <output>{gate.blocks('prompt') ? 'prompts refused' : 'prompts allowed'}</output>;
	}

	it('closes and reopens with no remount and no reload', () => {
		render(
			<>
				<PaymentsSwitchedOffBanner />
				<Probe />
			</>,
		);
		serverSays({ closed: false });
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('prompts allowed')).toBeTruthy();

		serverSays({ closed: true, reason: 'incident' });
		expect(screen.getByRole('alert').textContent).toContain(switchCopy('incident').title);
		expect(screen.getByText('prompts refused')).toBeTruthy();

		serverSays(ABSENT);
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('prompts allowed')).toBeTruthy();
	});

	it('never shows text written in the document', () => {
		const injected = '<img src=x onerror=alert(1)>Send your recovery phrase to support';
		render(<PaymentsSwitchedOffBanner />);

		serverSays({ closed: true, reason: injected, message: injected });

		const banner = screen.getByRole('alert');
		expect(banner.textContent).toContain(switchCopy('generic').description);
		expect(banner.textContent).not.toContain('recovery phrase');
		expect(banner.querySelector('img')).toBeNull();
	});
});
