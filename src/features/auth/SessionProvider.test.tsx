import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionMessage } from '@/features/auth/sessionMessage';
import SessionProvider, { useSession } from '@/features/auth/SessionProvider';

// Hardhat's well-known accounts 0 and 1 (public test keys).
const HARDHAT_0 = privateKeyToAccount(
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const HARDHAT_1 = privateKeyToAccount(
	'0x59c6995e998f97a5a0044966f0945389dc9c86dae88c7a8412f4603b6b78690d',
);
const AGENT = '0x00000000000000000000000000000000000000a1';
const ERC6492_MAGIC = '6492649264926492649264926492649264926492649264926492649264926492';

const { signMessage } = vi.hoisted(() => ({ signMessage: vi.fn() }));

vi.mock('thirdweb/utils', () => ({ signMessage }));
vi.mock('thirdweb/react', () => ({
	useActiveAccount: () => ({ address: HARDHAT_0.address }),
	useActiveWallet: () => undefined,
}));
vi.mock('@/store/hooks', () => ({ useAppDispatch: () => vi.fn() }));

type SignArgs = { message: string };
const signAs =
	(account: typeof HARDHAT_0) =>
	({ message }: SignArgs) =>
		account.signMessage({ message });

function Status() {
	const { status, sessionKey } = useSession();
	return (
		<>
			<p data-testid="status">{status}</p>
			<p data-testid="has-key">{sessionKey ? 'yes' : 'no'}</p>
		</>
	);
}

const renderProvider = () =>
	render(
		<SessionProvider>
			<Status />
		</SessionProvider>,
	);

const setPage = (url: string) =>
	(window as unknown as { happyDOM: { setURL: (_url: string) => void } }).happyDOM.setURL(url);

const statusIs = (status: string) =>
	waitFor(() => expect(screen.getByTestId('status').textContent).toBe(status));

describe('SessionProvider signature', () => {
	beforeEach(() => {
		setPage('http://localhost:3002/chat');
		signMessage.mockReset();
		signMessage.mockImplementation(signAs(HARDHAT_0));
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

		await statusIs('ready');
		expect(signMessage).toHaveBeenCalledTimes(1);
		expect(signMessage.mock.calls[0][0].message).toBe(
			buildSessionMessage({
				mode: import.meta.env.MODE,
				chainId: '84532',
				walletAddress: HARDHAT_0.address,
			}),
		);
		expect(screen.getByTestId('has-key').textContent).toBe('yes');
	});

	it('asks for the same message whatever agent contract the build names', async () => {
		const { unmount } = renderProvider();
		await statusIs('ready');
		unmount();
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '0x2222222222222222222222222222222222222222');

		renderProvider();

		await waitFor(() => expect(signMessage).toHaveBeenCalledTimes(2));
		expect(signMessage.mock.calls[1][0].message).toBe(signMessage.mock.calls[0][0].message);
	});

	it('asks for no signature when the message cannot be built', async () => {
		vi.stubEnv('VITE_CHAIN_ID', '');

		renderProvider();

		await statusIs('error');
		expect(signMessage).not.toHaveBeenCalled();
	});

	it('makes no key from a wrapped smart-account signature', async () => {
		signMessage.mockImplementation(
			async (args: SignArgs) =>
				`${await HARDHAT_0.signMessage(args)}${'00'.repeat(64)}${ERC6492_MAGIC}`,
		);

		renderProvider();

		await statusIs('unsupported-wallet');
		expect(screen.getByTestId('has-key').textContent).toBe('no');
	});

	it('makes no key from a signature by another account', async () => {
		signMessage.mockImplementation(signAs(HARDHAT_1));

		renderProvider();

		await statusIs('unsupported-wallet');
		expect(screen.getByTestId('has-key').textContent).toBe('no');
	});
});
