import { toast } from 'sonner';
import { keccak256, stringToBytes } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/faucetService', () => ({
	default: vi.fn(),
	awaitFaucetReceipt: vi.fn(),
	DEFAULT_FAUCET_AMOUNT: 100,
	FAUCET_POLL_MS: 2000,
	FAUCET_WAIT_ATTEMPTS: 30,
	FAUCET_WAIT_MS: 60000,
}));
vi.mock('@/lib/utils', () => ({ wait: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ encryptData: vi.fn() }));
vi.mock('@/lib/ecies', () => ({
	default: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

import { FEE_TOKEN_PROFILES, type FeeTokenProfile } from '@/config/feeToken';
import AbleTokenABI from '@/lib/abi/AbleToken.json';
import EVMAIAgentABI from '@/lib/abi/EVMAIAgent.json';
import EVMAIAgentEscrowABI from '@/lib/abi/EVMAIAgentEscrow.json';
import SenseTokenABI from '@/lib/abi/SenseToken.json';
import { feeTokenBlockCopy, FeeTokenBlockedError } from '@/lib/feeTokenCheck';

import { buildErrorHandler } from './useChatMutations';

// Helper that creates a pre-built handler with test defaults (no faucet network)
// Every case asserts on the one shared toast mock. Without this a case can pass on a call an
// earlier case made, which is how a selector that never matched once went unnoticed.
beforeEach(() => {
	vi.clearAllMocks();
});

// What a node returns: the first four bytes of keccak256 of the canonical signature. Worked
// out here from the ABI, not with the code under test.
type AbiEntry = { type: string; name?: string; inputs?: { type: string }[] };
function realSelector(abi: unknown[], name: string): string {
	const item = (abi as AbiEntry[]).find(entry => entry.type === 'error' && entry.name === name);
	if (!item) throw new Error(`${name} is not an error in this ABI`);
	const signature = `${name}(${(item.inputs ?? []).map(input => input.type).join(',')})`;
	return keccak256(stringToBytes(signature)).slice(0, 10);
}
// thirdweb decodes a revert against the contract that was called. An error raised by the
// token inside an escrow call is not in that ABI, so this is all the message carries.
const undecoded = (selector: string) => `Encoded error signature "${selector}" not found on ABI.`;

function makeHandler() {
	return buildErrorHandler(false, false, 100, vi.fn());
}

describe('buildErrorHandler — Token errors', () => {
	const profiles = [FEE_TOKEN_PROFILES.SENSE, FEE_TOKEN_PROFILES.ABLE];
	const handlerFor = (profile: FeeTokenProfile) =>
		buildErrorHandler(false, false, 100, vi.fn(), profile);

	it.each(profiles)('ERC20InsufficientBalance names the fee token ($symbol)', profile => {
		handlerFor(profile)({ message: 'ERC20InsufficientBalance' }, 'send message');

		expect(toast.error).toHaveBeenCalledWith(
			`Insufficient ${profile.symbol} Balance`,
			expect.any(Object),
		);
	});

	it('ERC20InsufficientAllowance → toast.error "Spending Limit Reached"', () => {
		const handler = makeHandler();
		handler({ message: 'ERC20InsufficientAllowance' }, 'send message');
		expect(toast.error).toHaveBeenCalledWith('Spending Limit Reached', expect.any(Object));
	});

	// A token that moves only to listed addresses refuses the payment when the escrow or the
	// treasury is not listed. Decoded whichever token the build is for: with the other token
	// the error can never arrive, and a build pointed at the wrong token still explains itself.
	it.each(profiles)('a refused transfer is explained, by name ($symbol build)', profile => {
		handlerFor(profile)({ message: 'execution reverted: TransferNotAllowed' }, 'send message');

		expect(toast.error).toHaveBeenCalledWith('Payment Not Accepted', expect.any(Object));
	});

	it.each(profiles)('a refused transfer is explained, by selector ($symbol build)', profile => {
		const selector = realSelector(SenseTokenABI.abi, 'TransferNotAllowed');

		handlerFor(profile)({ message: undecoded(selector) }, 'send message');

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('Payment Not Accepted', expect.any(Object));
	});

	// The same refusal means different things. A payment that is refused took nothing. A
	// cancellation that is refused leaves the prompt's fee held, and trying again cannot
	// help: the way out is the refund. A refund that is refused took nothing either, but
	// "nothing was charged" is no answer to someone asking for their tokens back.
	it.each([
		['send message', 'Payment Not Accepted', /no tokens were taken/i],
		['regenerate response', 'Payment Not Accepted', /no tokens were taken/i],
		['branch conversation', 'Payment Not Accepted', /no tokens were taken/i],
		['update conversation', 'Payment Not Accepted', /no tokens were taken/i],
		['cancel prompt', 'Could Not Cancel', /still held.*refund/i],
		['process refund', 'Refund Not Sent', /contact support/i],
	])('a refused transfer during "%s" says %s', (action, title, description) => {
		handlerFor(FEE_TOKEN_PROFILES.SENSE)({ message: 'TransferNotAllowed' }, action);

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(
			title,
			expect.objectContaining({ description: expect.stringMatching(description) }),
		);
	});

	it.each(profiles)('a paused token is explained ($symbol build)', profile => {
		handlerFor(profile)(
			{ message: undecoded(realSelector(profile.abi as unknown[], 'EnforcedPause')) },
			'send message',
		);

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('Payments Paused', expect.any(Object));
	});

	it('a token transfer that fails without a reason is explained', () => {
		makeHandler()({ message: 'SafeERC20FailedOperation - 0x1234' }, 'send message');

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith('Payment Failed', expect.any(Object));
	});

	it('the refused-transfer message names no token', () => {
		handlerFor(FEE_TOKEN_PROFILES.SENSE)({ message: 'TransferNotAllowed' }, 'send message');

		const [title, options] = vi.mocked(toast.error).mock.calls.at(-1) ?? [];
		// Whole words, so the product's own name is not mistaken for the token's.
		expect(`${title} ${(options as { description?: string })?.description}`).not.toMatch(
			/\b(SENSE|ABLE)\b/,
		);
	});
});

// One row per error the handler explains. Each is sent as a node sends it, by selector
// alone, and must produce its own message and no other.
describe('buildErrorHandler — every explained error is recognised by its selector', () => {
	it.each([
		['ERC20InsufficientBalance', 'Insufficient ABLE Balance', AbleTokenABI.abi],
		['ERC20InsufficientAllowance', 'Spending Limit Reached', AbleTokenABI.abi],
		['NoActiveSpendingLimit', 'No Active Plan', EVMAIAgentEscrowABI.abi],
		['SpendingLimitExpired', 'Plan Expired', EVMAIAgentEscrowABI.abi],
		['InsufficientSpendingLimitAllowance', 'Limit Reached', EVMAIAgentEscrowABI.abi],
		['HasPendingPrompts', 'Pending Action', EVMAIAgentEscrowABI.abi],
		['PromptNotCancellableYet', 'Too Soon to Cancel', EVMAIAgentEscrowABI.abi],
		['PromptNotRefundableYet', 'Too Soon to Refund', EVMAIAgentEscrowABI.abi],
		['NotPromptOwner', 'Access Denied', EVMAIAgentEscrowABI.abi],
		['EscrowNotPending', 'Action Invalid', EVMAIAgentEscrowABI.abi],
		['EscrowNotFound', 'Request Not Found', EVMAIAgentEscrowABI.abi],
		['SafeERC20FailedOperation', 'Payment Failed', EVMAIAgentEscrowABI.abi],
		['RegenerationAlreadyPending', 'Regeneration in Progress', EVMAIAgentABI.abi],
		['JobAlreadyFinalized', 'Request Already Finalized', EVMAIAgentABI.abi],
		['Unauthorized', 'Access Denied', EVMAIAgentABI.abi],
		['InvalidPromptMessageId', 'Invalid Message', EVMAIAgentABI.abi],
	])('%s shows "%s"', (name, title, abi) => {
		const handler = buildErrorHandler(false, false, 100, vi.fn(), FEE_TOKEN_PROFILES.ABLE);

		handler({ message: undecoded(realSelector(abi as unknown[], name)) }, 'send message');

		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(title, expect.any(Object));
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
		const handler = buildErrorHandler(true, false, 100, vi.fn());
		handler({ message: 'ERC20InsufficientBalance' }, 'send message');
		const [, options] = (toast.error as any).mock.calls[0];
		// duration should be Infinity on testnet so the button stays visible
		expect(options.duration).toBe(Infinity);
	});

	it('isLocalnet=true also renders the faucet button (persistent toast)', () => {
		(toast.error as any).mockClear();
		const handler = buildErrorHandler(false, true, 100, vi.fn());
		handler({ message: 'ERC20InsufficientBalance' }, 'send message');
		const [, options] = (toast.error as any).mock.calls[0];
		expect(options.duration).toBe(Infinity);
	});

	it('neither network → no faucet button (default 4s toast)', () => {
		(toast.error as any).mockClear();
		const handler = buildErrorHandler(false, false, 100, vi.fn());
		handler({ message: 'ERC20InsufficientBalance' }, 'send message');
		const [, options] = (toast.error as any).mock.calls[0];
		expect(options.duration).toBe(4000);
	});
});

describe('buildErrorHandler — an action the fee token check switched off', () => {
	it('says what the banner says, and does not log it as a failure', () => {
		(toast.error as any).mockClear();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const profile = FEE_TOKEN_PROFILES.SENSE;
		const handler = buildErrorHandler(false, false, 100, vi.fn(), profile);

		handler(new FeeTokenBlockedError('treasury-not-exempt'), 'branch conversation');

		const copy = feeTokenBlockCopy('treasury-not-exempt', profile.symbol);
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(copy?.title, { description: copy?.description });
		expect(logged).not.toHaveBeenCalled();
		logged.mockRestore();
	});
});
