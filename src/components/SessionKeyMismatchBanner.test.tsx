import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SessionKeyMismatchBanner from '@/components/SessionKeyMismatchBanner';
import { forgetSessionKeyReports } from '@/lib/sessionKeyReport';

const { checkSessionKey, session } = vi.hoisted(() => ({
	checkSessionKey: vi.fn(),
	session: {
		sessionKey: {} as CryptoKey | null,
		ownerAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
	},
}));

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/sessionKeyCheck', () => ({ checkSessionKey }));
vi.mock('@/features/auth/SessionProvider', () => ({ useSession: () => session }));

const renderBanner = () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<SessionKeyMismatchBanner />
		</QueryClientProvider>,
	);
};

const NOTICE = /some history on this device cannot be opened/i;

describe('SessionKeyMismatchBanner', () => {
	beforeEach(() => {
		checkSessionKey.mockReset();
		vi.mocked(Sentry.captureException).mockClear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		forgetSessionKeyReports();
		vi.restoreAllMocks();
	});

	it('says history written under another key cannot be opened, and that nothing is deleted', async () => {
		checkSessionKey.mockResolvedValue('mismatch');

		renderBanner();

		expect(await screen.findByText(NOTICE)).toBeTruthy();
		expect(screen.getByText(/nothing has been deleted/i)).toBeTruthy();
		expect(checkSessionKey).toHaveBeenCalledWith(session.sessionKey, session.ownerAddress);
	});

	it('reports the mismatch to Sentry once per page load, by kind only', async () => {
		checkSessionKey.mockResolvedValue('mismatch');

		const first = renderBanner();
		await screen.findByText(NOTICE);
		first.unmount();
		renderBanner();
		await screen.findByText(NOTICE);

		expect(Sentry.captureException).toHaveBeenCalledTimes(1);
		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0] as [
			Error,
			{ tags: Record<string, string>; extra?: unknown },
		];
		expect(context.tags).toEqual({ check: 'session-key', kind: 'mismatch' });
		expect(context.extra).toBeUndefined();
		expect(JSON.stringify([error.message, context])).not.toMatch(/0x[0-9a-fA-F]{40}/);
	});

	it('can be dismissed', async () => {
		checkSessionKey.mockResolvedValue('mismatch');

		renderBanner();
		fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }));

		expect(screen.queryByText(NOTICE)).toBeNull();
	});

	it.each(['written', 'matches'])('shows nothing when the check is %s', async outcome => {
		checkSessionKey.mockResolvedValue(outcome);

		renderBanner();

		await waitFor(() => expect(checkSessionKey).toHaveBeenCalled());
		expect(screen.queryByText(NOTICE)).toBeNull();
		expect(Sentry.captureException).not.toHaveBeenCalled();
	});

	it('shows nothing and blocks nothing when the check fails', async () => {
		checkSessionKey.mockRejectedValue(new TypeError('a fault'));

		renderBanner();

		await waitFor(() => expect(checkSessionKey).toHaveBeenCalled());
		expect(screen.queryByText(NOTICE)).toBeNull();
	});
});
