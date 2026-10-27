import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UpdatePrompt, { UPDATE_TOAST_ID } from '@/components/UpdatePrompt';

// --- virtual:pwa-register/react ------------------------------------------------------------
// The real hook only exists inside the Vite build (the PWA plugin provides the module), so
// the test owns a tiny stand-in whose state it flips between renders.
const sw = {
	needRefresh: false,
	setNeedRefresh: vi.fn(),
	updateServiceWorker: vi.fn(),
};
vi.mock('virtual:pwa-register/react', () => ({
	useRegisterSW: () => ({
		needRefresh: [sw.needRefresh, sw.setNeedRefresh] as const,
		offlineReady: [false, vi.fn()] as const,
		updateServiceWorker: sw.updateServiceWorker,
	}),
}));

// --- session -----------------------------------------------------------------------------
const session = { status: 'ready' as 'ready' | 'deriving' };
vi.mock('@/features/auth/SessionProvider', () => ({
	useSession: () => ({ status: session.status, sessionKey: null, ownerAddress: '0xowner' }),
}));

// --- toast -------------------------------------------------------------------------------
type ToastOptions = {
	id?: string | number;
	duration?: number;
	action?: { label: string; onClick: () => void };
	onDismiss?: () => void;
};
const toastMock = Object.assign(vi.fn<(message: string, options?: ToastOptions) => void>(), {
	dismiss: vi.fn(),
});
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
	return { client, rerender: () => view.rerender(
		<QueryClientProvider client={client}>
			<UpdatePrompt />
		</QueryClientProvider>,
	) };
}

/** A mutation that stays pending until the test resolves it — a wallet flow in flight. */
function startPendingMutation(client: QueryClient) {
	let settle: () => void = () => {};
	const observer = new MutationObserver(client, {
		mutationFn: () =>
			new Promise<void>(resolve => {
				settle = resolve;
			}),
	});
	observer.mutate().catch(() => {});
	return async () => {
		settle();
		await act(async () => {
			await Promise.resolve();
		});
	};
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

		await finish();
		expect(toastMock).toHaveBeenCalledTimes(1);
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

	it('withdraws a showing toast when a wallet flow starts, so Reload cannot interrupt it', async () => {
		sw.needRefresh = true;
		const client = new QueryClient();
		renderPrompt(client);
		expect(toastMock).toHaveBeenCalledTimes(1);

		const finish = startPendingMutation(client);
		await act(async () => {
			await Promise.resolve();
		});
		expect(toastMock.dismiss).toHaveBeenCalledWith(UPDATE_TOAST_ID);
		await finish();
	});
});
