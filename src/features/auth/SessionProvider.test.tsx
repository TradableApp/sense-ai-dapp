import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionMessage } from '@/features/auth/sessionMessage';
import SessionProvider, { useSession } from '@/features/auth/SessionProvider';

const WALLET = '0xabc123def456abc123def456abc123def456abc1';
const AGENT = '0x00000000000000000000000000000000000000a1';

const { signMessage } = vi.hoisted(() => ({ signMessage: vi.fn() }));

vi.mock('thirdweb/utils', () => ({ signMessage }));
vi.mock('thirdweb/react', () => ({
	useActiveAccount: () => ({ address: WALLET }),
	useActiveWallet: () => undefined,
}));
vi.mock('@/store/hooks', () => ({ useAppDispatch: () => vi.fn() }));

function Status() {
	const { status } = useSession();
	return <p data-testid="status">{status}</p>;
}

const renderProvider = () =>
	render(
		<SessionProvider>
			<Status />
		</SessionProvider>,
	);

describe('SessionProvider signature', () => {
	beforeEach(() => {
		signMessage.mockReset();
		signMessage.mockResolvedValue(`0x${'1b'.repeat(65)}`);
		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('asks the wallet to sign the message built for this build and wallet', async () => {
		renderProvider();

		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
		expect(signMessage).toHaveBeenCalledTimes(1);
		expect(signMessage.mock.calls[0][0].message).toBe(
			buildSessionMessage({
				mode: import.meta.env.MODE,
				chainId: '84532',
				walletAddress: WALLET,
			}),
		);
	});

	it('asks for the same message whatever page it is opened on', async () => {
		(window as unknown as { happyDOM: { setURL: (_url: string) => void } }).happyDOM.setURL(
			'https://another-site.example/chat',
		);

		renderProvider();

		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
		const message = signMessage.mock.calls[0][0].message as string;
		expect(message).not.toContain('another-site.example');
		expect(message).toBe(
			buildSessionMessage({
				mode: import.meta.env.MODE,
				chainId: '84532',
				walletAddress: WALLET,
			}),
		);
	});

	it('asks for the same message whatever agent contract the build names', async () => {
		const { unmount } = renderProvider();
		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
		unmount();
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '0x2222222222222222222222222222222222222222');

		renderProvider();

		await waitFor(() => expect(signMessage).toHaveBeenCalledTimes(2));
		expect(signMessage.mock.calls[1][0].message).toBe(signMessage.mock.calls[0][0].message);
	});

	it('asks for no signature when the message cannot be built', async () => {
		vi.stubEnv('VITE_CHAIN_ID', '');

		renderProvider();

		await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
		expect(signMessage).not.toHaveBeenCalled();
	});
});
