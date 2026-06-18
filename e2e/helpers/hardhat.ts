import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

const RPC_URL = 'http://127.0.0.1:8545';
let reqId = 1;

// ── Per-test fresh accounts ───────────────────────────────────────────────────
// Hardhat's deterministic dev accounts (mnemonic "test test … junk"). Account 0
// is the deployer/oracle and account 1 is the legacy shared user (see
// mock-wallet.ts) — both are RESERVED. Accounts 2..19 are unlocked on the node
// and free for per-test "fresh user" isolation: a test that needs a pristine
// history + plan claims one (via helpers/fresh-account.ts) so its on-chain state
// never collides with another test's. 18 accounts comfortably covers the ~10
// answer-flow tests. PUBLIC Hardhat test keys — NEVER use on any real network.
export interface HardhatAccount {
	address: string;
	privateKey: string;
}

export const FRESH_TEST_ACCOUNTS: readonly HardhatAccount[] = [
	{
		address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
		privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
	},
	{
		address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
		privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
	},
	{
		address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
		privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
	},
	{
		address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
		privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
	},
	{
		address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
		privateKey: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
	},
	{
		address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
		privateKey: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
	},
	{
		address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
		privateKey: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
	},
	{
		address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
		privateKey: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
	},
	{
		address: '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
		privateKey: '0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897',
	},
	{
		address: '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
		privateKey: '0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82',
	},
	{
		address: '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
		privateKey: '0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1',
	},
	{
		address: '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec',
		privateKey: '0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd',
	},
	{
		address: '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097',
		privateKey: '0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa',
	},
	{
		address: '0xcd3B766CCDd6AE721141F452C550Ca635964ce71',
		privateKey: '0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61',
	},
	{
		address: '0x2546BcD3c84621e976D8185a91A922aE77ECEc30',
		privateKey: '0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0',
	},
	{
		address: '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E',
		privateKey: '0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd',
	},
	{
		address: '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
		privateKey: '0xde9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0',
	},
	{
		address: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
		privateKey: '0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e',
	},
];

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
	const res = await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }),
	});
	const json = (await res.json()) as { result?: unknown; error?: { message: string } };
	if (json.error) throw new Error(`Hardhat RPC error: ${json.error.message}`);
	return json.result;
}

export async function getBlockNumber(): Promise<number> {
	const hex = (await rpc('eth_blockNumber')) as string;
	return parseInt(hex, 16);
}

export async function getBalance(address: string): Promise<bigint> {
	const hex = (await rpc('eth_getBalance', [address, 'latest'])) as string;
	return BigInt(hex);
}

export async function mineBlocks(count: number): Promise<void> {
	await rpc('hardhat_mine', [`0x${count.toString(16)}`]);
}

export async function increaseTime(seconds: number): Promise<void> {
	await rpc('evm_increaseTime', [seconds]);
	await rpc('evm_mine', []);
}

export async function takeSnapshot(): Promise<string> {
	return (await rpc('evm_snapshot')) as string;
}

export async function revertToSnapshot(snapshotId: string): Promise<void> {
	await rpc('evm_revert', [snapshotId]);
}

export async function isHardhatRunning(): Promise<boolean> {
	try {
		await getBlockNumber();
		return true;
	} catch {
		return false;
	}
}

export async function getCurrentBlock(): Promise<number> {
	return getBlockNumber();
}

// ERC-20 ABI function selectors
const BALANCE_OF_SELECTOR = '0x70a08231';
const ALLOWANCE_SELECTOR = '0xdd62ed3e';

function padAddress(address: string): string {
	return `0x${address.replace('0x', '').toLowerCase().padStart(64, '0')}`;
}

async function callContract(contractAddress: string, data: string): Promise<string> {
	return (await rpc('eth_call', [{ to: contractAddress, data }, 'latest'])) as string;
}

export async function getABLEBalance(
	tokenAddress: string,
	accountAddress: string,
): Promise<bigint> {
	const data = BALANCE_OF_SELECTOR + padAddress(accountAddress).slice(2);
	const result = await callContract(tokenAddress, data);
	return BigInt(result);
}

export async function getEscrowBalance(
	tokenAddress: string,
	escrowAddress: string,
): Promise<bigint> {
	const data = BALANCE_OF_SELECTOR + padAddress(escrowAddress).slice(2);
	const result = await callContract(tokenAddress, data);
	return BigInt(result);
}

export async function getAllowance(
	tokenAddress: string,
	ownerAddress: string,
	spenderAddress: string,
): Promise<bigint> {
	const data =
		ALLOWANCE_SELECTOR + padAddress(ownerAddress).slice(2) + padAddress(spenderAddress).slice(2);
	const result = await callContract(tokenAddress, data);
	return BigInt(result);
}

// ── Funding (the localnet "treasury": there is no faucet on localnet) ─────────
const TRANSFER_SELECTOR = '0xa9059cbb'; // transfer(address,uint256)
// Hardhat account 0 — deployer/treasury; holds the full ABLE supply and is
// unlocked on the node, so eth_sendTransaction needs no signing key.
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function padUint(value: bigint): string {
	return value.toString(16).padStart(64, '0');
}

async function waitForReceipt(txHash: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
		if (receipt) return;
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	throw new Error(`Transaction ${txHash} not mined within ${timeoutMs}ms`);
}

/**
 * Fund a user with ABLE by transferring from the deployer/treasury (account 0).
 * This is the localnet equivalent of the testnet faucet — on localnet the full
 * supply is minted to the deployer at deploy time, so users start with 0 ABLE.
 * @param amount Amount in base units (wei-scale, 18 decimals).
 */
export async function fundABLE(
	tokenAddress: string,
	toAddress: string,
	amount: bigint,
): Promise<void> {
	const data = TRANSFER_SELECTOR + padAddress(toAddress).slice(2) + padUint(amount);
	const txHash = (await rpc('eth_sendTransaction', [
		{ from: DEPLOYER_ADDRESS, to: tokenAddress, data },
	])) as string;
	await waitForReceipt(txHash);
}

// ── Plan activation + fee control (programmatic, no UI) ───────────────────────
// The test user (Hardhat account 1) and the deployer/owner (account 0) are both
// unlocked on the local node, so eth_sendTransaction is authorized without a
// signature. Calldata is viem-encoded so selectors are exact (these calls take
// address/bytes args that are fiddly to hand-roll). Mirrors the on-chain writes
// the dApp makes via ManagePlanModal (approve → setSpendingLimit) and the
// owner-only setPromptFee used to change the per-prompt cost.
const ESCROW_ABI = parseAbi([
	'function setSpendingLimit(uint256 _allowance, uint256 _expiresAt)',
	'function setPromptFee(uint256 _newFee)',
	'function setBranchFee(uint256 _newFee)',
	'function setCancellationFee(uint256 _newFee)',
	'function setMetadataUpdateFee(uint256 _newFee)',
	'function setTreasury(address _newTreasury)',
	'function promptFee() view returns (uint256)',
	'function treasury() view returns (address)',
	'function spendingLimits(address) view returns (uint256 allowance, uint256 spentAmount, uint256 expiresAt)',
	'function processRefund(uint256 _answerMessageId)',
]);
const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

export async function getLatestBlockTimestamp(): Promise<number> {
	const block = (await rpc('eth_getBlockByNumber', ['latest', false])) as { timestamp: string };
	return parseInt(block.timestamp, 16);
}

async function sendFrom(from: string, to: string, data: string): Promise<void> {
	const txHash = (await rpc('eth_sendTransaction', [{ from, to, data }])) as string;
	await waitForReceipt(txHash);
}

/** ERC-20 approve(spender, amount) sent by `ownerAddress` (an unlocked account). */
export async function approveABLE(
	tokenAddress: string,
	ownerAddress: string,
	spenderAddress: string,
	amount: bigint,
): Promise<void> {
	const data = encodeFunctionData({
		abi: ERC20_APPROVE_ABI,
		functionName: 'approve',
		args: [spenderAddress as `0x${string}`, amount],
	});
	await sendFrom(ownerAddress, tokenAddress, data);
}

/**
 * Activate a spending plan for `userAddress` exactly as the dApp does, but
 * programmatically: ERC-20 approve(escrow, allowance) → setSpendingLimit(
 * allowance, now + durationSec). The allowance model escrows tokens per-prompt
 * (no upfront move), so this is the precondition for sending a real prompt.
 * @param allowance Spending limit in base units (wei-scale, 18 decimals).
 */
export async function activatePlan(
	tokenAddress: string,
	escrowAddress: string,
	userAddress: string,
	allowance: bigint,
	durationSec = 30 * 24 * 60 * 60,
): Promise<void> {
	await approveABLE(tokenAddress, userAddress, escrowAddress, allowance);
	const expiresAt = (await getLatestBlockTimestamp()) + durationSec;
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setSpendingLimit',
		args: [allowance, BigInt(expiresAt)],
	});
	await sendFrom(userAddress, escrowAddress, data);
}

/**
 * Claim a refund for a stuck (never-answered) prompt, signed by the user. The contract
 * requires `block.timestamp >= escrow.createdAt + REFUND_TIMEOUT` (1h) and the job to be
 * unfinalized, so advance EVM time with `increaseTime` first. The dApp's in-app refund
 * affordance is wall-clock-gated (Date.now), which `increaseTime` can't move, so a cross-layer
 * refund test drives the on-chain claim here and verifies the subgraph/dApp reflect it.
 * @param answerMessageId The PromptRequest id (= answerMessageId) of the stuck prompt.
 */
export async function processRefund(
	escrowAddress: string,
	userAddress: string,
	answerMessageId: bigint | string,
): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'processRefund',
		args: [BigInt(answerMessageId)],
	});
	await sendFrom(userAddress, escrowAddress, data);
}

/** Read the current per-prompt fee (wei-scale) from the escrow. */
export async function getPromptFee(escrowAddress: string): Promise<bigint> {
	const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: 'promptFee', args: [] });
	const result = await callContract(escrowAddress, data);
	return BigInt(result);
}

/**
 * Set the per-prompt fee (owner-only). Sent by the deployer (account 0), which
 * is the contract owner on localnet. @param newFee in base units (wei-scale).
 */
export async function setPromptFee(escrowAddress: string, newFee: bigint): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setPromptFee',
		args: [newFee],
	});
	await sendFrom(DEPLOYER_ADDRESS, escrowAddress, data);
}

/** Set the per-branch fee (owner-only). @param newFee wei-scale. */
export async function setBranchFee(escrowAddress: string, newFee: bigint): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setBranchFee',
		args: [newFee],
	});
	await sendFrom(DEPLOYER_ADDRESS, escrowAddress, data);
}

/** Set the cancellation fee (owner-only). @param newFee wei-scale. */
export async function setCancellationFee(escrowAddress: string, newFee: bigint): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setCancellationFee',
		args: [newFee],
	});
	await sendFrom(DEPLOYER_ADDRESS, escrowAddress, data);
}

/** Set the metadata-update fee (owner-only). @param newFee wei-scale. */
export async function setMetadataUpdateFee(escrowAddress: string, newFee: bigint): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setMetadataUpdateFee',
		args: [newFee],
	});
	await sendFrom(DEPLOYER_ADDRESS, escrowAddress, data);
}

/** Set the treasury payout address (owner-only). Sent by the deployer/owner (account 0). */
export async function setTreasury(escrowAddress: string, newTreasury: string): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setTreasury',
		args: [newTreasury as `0x${string}`],
	});
	await sendFrom(DEPLOYER_ADDRESS, escrowAddress, data);
}

/** Read the current treasury payout address from the escrow. */
export async function getTreasury(escrowAddress: string): Promise<string> {
	const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: 'treasury', args: [] });
	const result = await callContract(escrowAddress, data);
	// eth_call returns a 32-byte word; the address is the low 20 bytes.
	return `0x${result.slice(-40)}`;
}

/**
 * Read a user's on-chain spending limit: { allowance, spentAmount, expiresAt }
 * (wei-scale). `spentAmount` is exactly what the dApp surfaces as "Spent" in the
 * usage dashboard (via useUsagePlan), so it's the cross-check for cost changes.
 */
export async function getSpendingLimit(
	escrowAddress: string,
	userAddress: string,
): Promise<{ allowance: bigint; spentAmount: bigint; expiresAt: bigint }> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'spendingLimits',
		args: [userAddress as `0x${string}`],
	});
	const result = await callContract(escrowAddress, data);
	// No cast: decodeFunctionResult infers the tuple from the parseAbi types, so a
	// future change to the spendingLimits struct surfaces as a type error here
	// rather than being silently truncated.
	const [allowance, spentAmount, expiresAt] = decodeFunctionResult({
		abi: ESCROW_ABI,
		functionName: 'spendingLimits',
		data: result as `0x${string}`,
	});
	return { allowance, spentAmount, expiresAt };
}
