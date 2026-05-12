import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';

// Mock all React / app-level imports so useChatMutations.jsx can be imported in Node.
// We do NOT mock 'ethers' — real ethers.Interface is needed for getError() to work.
vi.mock('sonner', () => ({
	toast: {
		error: vi.fn(),
		warning: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
		loading: vi.fn(),
		dismiss: vi.fn(),
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(),
	useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('thirdweb/react', () => ({
	useActiveAccount: vi.fn(),
	useActiveWallet: vi.fn(),
}));

vi.mock('thirdweb/rpc', () => ({
	eth_getTransactionReceipt: vi.fn(),
	getRpcClient: vi.fn(),
}));

vi.mock('thirdweb', () => ({
	getContract: vi.fn(),
	prepareContractCall: vi.fn(),
	sendAndConfirmTransaction: vi.fn(),
}));

vi.mock('@/config/thirdweb', () => ({ client: {} }));
vi.mock('@/config/contracts', () => ({
	CONTRACTS: {},
	TESTNET_CHAIN_ID: 84532,
}));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));
vi.mock('@/lib/faucetService', () => ({ default: vi.fn() }));
vi.mock('@/lib/utils', () => ({ wait: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ encryptData: vi.fn() }));
vi.mock('@/lib/ecies', () => ({
	default: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

import { buildErrorHandler } from './useChatMutations';

// Helper that creates a pre-built handler with test defaults
function makeHandler() {
	return buildErrorHandler(false, vi.fn());
}

describe('buildErrorHandler — Token errors', () => {
	it('ERC20InsufficientBalance → toast.error "Insufficient ABLE Balance"', () => {
		const handler = makeHandler();
		handler({ message: 'ERC20InsufficientBalance' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Insufficient ABLE Balance', expect.any(Object));
	});

	it('ERC20InsufficientAllowance → toast.error "Spending Limit Reached"', () => {
		const handler = makeHandler();
		handler({ message: 'ERC20InsufficientAllowance' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Spending Limit Reached', expect.any(Object));
	});
});

describe('buildErrorHandler — Escrow errors', () => {
	it('NoActiveSpendingLimit → toast.error "No Active Plan"', () => {
		const handler = makeHandler();
		handler({ message: 'NoActiveSpendingLimit' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('No Active Plan', expect.any(Object));
	});

	it('SpendingLimitExpired → toast.error "Plan Expired"', () => {
		const handler = makeHandler();
		handler({ message: 'SpendingLimitExpired' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Plan Expired', expect.any(Object));
	});

	it('InsufficientSpendingLimitAllowance → toast.error "Limit Reached"', () => {
		const handler = makeHandler();
		handler({ message: 'InsufficientSpendingLimitAllowance' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Limit Reached', expect.any(Object));
	});

	it('HasPendingPrompts → toast.error "Pending Action"', () => {
		const handler = makeHandler();
		handler({ message: 'HasPendingPrompts' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Pending Action', expect.any(Object));
	});

	it('PromptNotCancellableYet → toast.error "Too Soon to Cancel"', () => {
		const handler = makeHandler();
		handler({ message: 'PromptNotCancellableYet' }, 'cancel prompt');
		expect(toast.error).toHaveBeenCalledWith('Too Soon to Cancel', expect.any(Object));
	});

	it('PromptNotRefundableYet → toast.error "Too Soon to Refund"', () => {
		const handler = makeHandler();
		handler({ message: 'PromptNotRefundableYet' }, 'process refund');
		expect(toast.error).toHaveBeenCalledWith('Too Soon to Refund', expect.any(Object));
	});

	it('NotPromptOwner → toast.error "Access Denied"', () => {
		const handler = makeHandler();
		handler({ message: 'NotPromptOwner' }, 'cancel prompt');
		expect(toast.error).toHaveBeenCalledWith('Access Denied', expect.any(Object));
	});

	it('EscrowNotPending → toast.error "Action Invalid"', () => {
		const handler = makeHandler();
		handler({ message: 'EscrowNotPending' }, 'cancel prompt');
		expect(toast.error).toHaveBeenCalledWith('Action Invalid', expect.any(Object));
	});

	it('EscrowNotFound → toast.error "Request Not Found"', () => {
		const handler = makeHandler();
		handler({ message: 'EscrowNotFound' }, 'cancel prompt');
		expect(toast.error).toHaveBeenCalledWith('Request Not Found', expect.any(Object));
	});
});

describe('buildErrorHandler — Agent errors', () => {
	it('RegenerationAlreadyPending → toast.error "Regeneration in Progress"', () => {
		const handler = makeHandler();
		handler({ message: 'RegenerationAlreadyPending' }, 'regenerate response');
		expect(toast.error).toHaveBeenCalledWith('Regeneration in Progress', expect.any(Object));
	});

	it('JobAlreadyFinalized → toast.error "Request Already Finalized"', () => {
		const handler = makeHandler();
		handler({ message: 'JobAlreadyFinalized' }, 'regenerate response');
		expect(toast.error).toHaveBeenCalledWith('Request Already Finalized', expect.any(Object));
	});

	it('Unauthorized → toast.error "Access Denied"', () => {
		const handler = makeHandler();
		handler({ message: 'Unauthorized' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Access Denied', expect.any(Object));
	});

	it('InvalidPromptMessageId → toast.error "Invalid Message"', () => {
		const handler = makeHandler();
		handler({ message: 'InvalidPromptMessageId' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Invalid Message', expect.any(Object));
	});
});

describe('buildErrorHandler — Generic fallbacks', () => {
	it('"User rejected" → toast.warning "Transaction Cancelled"', () => {
		const handler = makeHandler();
		handler({ message: 'User rejected the request' }, 'send message');
		expect(toast.warning).toHaveBeenCalledWith('Transaction Cancelled', expect.any(Object));
	});

	it('"User denied" → toast.warning "Transaction Cancelled"', () => {
		const handler = makeHandler();
		handler({ message: 'MetaMask: User denied transaction' }, 'send message');
		expect(toast.warning).toHaveBeenCalledWith('Transaction Cancelled', expect.any(Object));
	});

	it('unknown error → toast.error with action name', () => {
		const handler = makeHandler();
		handler({ message: 'some unknown network error' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Failed to send message', expect.any(Object));
	});

	it('null error object → generic fallback without throwing', () => {
		const handler = makeHandler();
		expect(() => handler(null, 'send message')).not.toThrow();
		expect(toast.error).toHaveBeenCalledWith('Failed to send message', expect.any(Object));
	});

	it('isTestnet=true renders faucet button in ERC20InsufficientBalance toast', () => {
		(toast.error as any).mockClear();
		const handler = buildErrorHandler(true, vi.fn());
		handler({ message: 'ERC20InsufficientBalance' }, 'send message');
		const [, options] = (toast.error as any).mock.calls[0];
		// duration should be Infinity on testnet so the button stays visible
		expect(options.duration).toBe(Infinity);
	});
});
