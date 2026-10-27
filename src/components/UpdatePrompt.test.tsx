import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UpdatePrompt, { UPDATE_TOAST_ID } from '@/components/UpdatePrompt';

type ToastOptions = {
	id?: string | number;
	duration?: number;
	action?: { label: string; onClick: () => void };
	onDismiss?: () => void;
};

// --- virtual:pwa-register/react ------------------------------------------------------------
// The real hook only exists inside the Vite build (the PWA plugin provides the module), so
// the test owns a tiny stand-in whose state it flips between renders.
const sw = vi.hoisted(() => ({
	needRefresh: false,
	setNeedRefresh: vi.fn(),
	updateServiceWorker: vi.fn(() => Promise.resolve()),
}));
vi.mock('virtual:pwa-register/react', () => ({
	useRegisterSW: () => ({
		needRefresh: [sw.needRefresh, sw.setNeedRefresh] as const,
		offlineReady: [false, vi.fn()] as const,
		updateServiceWorker: sw.updateServiceWorker,
	}),
}));

// --- session -----------------------------------------------------------------------------
const session = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'deriving' }));
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ status: session.status, sessionKey: null, ownerAddress: '0xowner' }),
}));

// --- toast -------------------------------------------------------------------------------
const toastMock = vi.hoisted(() =>
	Object.assign(vi.fn<(_message: string, _options?: ToastOptions) => void>(), {
		dismiss: vi.fn(),
		error: vi.fn<(_message: string, _options?: ToastOptions) => void>(),
	}),
);
vi.mock('@/components/ui/sonner', () => ({ toast: toastMock }));

vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));

// --- helpers -----------------------------------------------------------------------------
const reloadSpy = vi.fn();

function renderPrompt(client = new QueryClient()) {
	const view = render(
		<QueryClientProvider client={client}>
			<UpdatePrompt />
		</QueryClientProvider>,
	);
	return {
		client,
		rerender: () =>
			view.rerender(
				<QueryClientProvider client={client}>
					<UpdatePrompt />
				</QueryClientProvider>,
			),
	};
}

/**
 * A mutation that stays pending until the test settles it — a wallet flow in flight. The
 * mutation cache notifies subscribers on a macrotask, so tests observe its effects with
 * waitFor rather than a microtask tick.
 */
function startPendingMutation(client: QueryClient) {
	// The gate exists before mutate() so settling is valid even if the mutation function has
	// not been invoked yet (TanStack awaits its onMutate hooks first).
	let settle: () => void = () => {};
	const gate = new Promise<void>(resolve => {
		settle = resolve;
	});
	const observer = new MutationObserver(client, { mutationFn: () => gate });
	observer.mutate().catch(() => {});
	return () => settle();
}

const lastToastOptions = (): ToastOptions => {
	const call = toastMock.mock.calls.at(-1);
	if (!call) throw new Error('toast was never called');
	return call[1] ?? {};
};

beforeEach(() => {
	sw.needRefresh = false;
	session.status = 'ready';
	vi.clearAllMocks();
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { ...window.location, reload: reloadSpy },
	});
});

afterEach(cleanup);

describe('UpdatePrompt', () => {
	it('renders nothing and shows no toast while no new worker is waiting', () => {
		const { client } = renderPrompt();
		expect(toastMock).not.toHaveBeenCalled();
		client.clear();
	});

	it('shows a "new version" toast with a Reload action once a worker is waiting and the app is idle', () => {
		sw.needRefresh = true;
		renderPrompt();
		expect(toastMock).toHaveBeenCalledTimes(1);
		const [message, options] = toastMock.mock.calls[0];
		expect(message).toMatch(/new version/i);
		expect(options?.id).toBe(UPDATE_TOAST_ID);
		expect(options?.duration).toBe(Infinity);
		expect(options?.action?.label).toMatch(/reload/i);
	});

	it('never reloads on its own', () => {
		sw.needRefresh = true;
		renderPrompt();
		expect(reloadSpy).not.toHaveBeenCalled();
		expect(sw.updateServiceWorker).not.toHaveBeenCalled();
	});

	it('Reload hands control to the waiting worker and reloads through it', () => {
		sw.needRefresh = true;
		renderPrompt();
		lastToastOptions().action?.onClick();
		expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
	});

	it('dismissing the toast clears the waiting flag so it does not re-nag for this worker', () => {
		sw.needRefresh = true;
		renderPrompt();
		lastToastOptions().onDismiss?.();
		expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
	});

	it('defers the toast while a mutation (wallet transaction) is pending, then shows it', async () => {
		sw.needRefresh = true;
		const client = new QueryClient();
		const finish = startPendingMutation(client);
		renderPrompt(client);
		expect(toastMock).not.toHaveBeenCalled();

		finish();
		await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
	});

	it('defers the toast while the session key signature is being requested', () => {
		sw.needRefresh = true;
		session.status = 'deriving';
		const { rerender } = renderPrompt();
		expect(toastMock).not.toHaveBeenCalled();

		session.status = 'ready';
		rerender();
		expect(toastMock).toHaveBeenCalledTimes(1);
	});

	// sonner reports a programmatic dismiss through onDismiss as well, after React re-renders
	// the toast with its delete flag. A withdrawal must never be mistaken for the user
	// declining, whatever the timing, or the prompt would not come back after the flow.
	const dismissTimings: Array<[string, (_cb: () => void) => void]> = [
		['synchronously', cb => cb()],
		[
			'on a later tick',
			cb => {
				setTimeout(cb, 0);
			},
		],
		['never', () => {}],
	];
	it.each(dismissTimings)(
		'withdraws a showing toast when a wallet flow starts (sonner calls onDismiss %s) and brings it back',
		async (_timing, schedule) => {
			sw.needRefresh = true;
			const client = new QueryClient();
			renderPrompt(client);
			expect(toastMock).toHaveBeenCalledTimes(1);
			toastMock.dismiss.mockImplementation(() => {
				const { onDismiss } = lastToastOptions();
				schedule(() => onDismiss?.());
			});

			const finish = startPendingMutation(client);
			await waitFor(() => expect(toastMock.dismiss).toHaveBeenCalledWith(UPDATE_TOAST_ID));
			await new Promise<void>(resolve => {
				setTimeout(resolve, 0);
			});
			expect(sw.setNeedRefresh).not.toHaveBeenCalledWith(false);

			finish();
			await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(2));

			// The returned prompt still honours a real dismissal by the user.
			lastToastOptions().onDismiss?.();
			expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
		},
	);

	it('tells the user when the waiting worker fails to activate, and never reloads for them', async () => {
		sw.needRefresh = true;
		sw.updateServiceWorker.mockRejectedValueOnce(new Error('postMessage failed'));
		renderPrompt();
		lastToastOptions().action?.onClick();

		await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
		const [message, options] = toastMock.error.mock.calls[0];
		expect(message).toMatch(/could not be applied/i);
		expect(options?.action?.label).toMatch(/reload/i);
		expect(reloadSpy).not.toHaveBeenCalled();

		options?.action?.onClick();
		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});
});
