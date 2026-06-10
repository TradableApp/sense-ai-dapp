import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

const RPC_URL = 'http://127.0.0.1:8545';
let reqId = 1;

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

export async function advanceTime(seconds: number): Promise<void> {
	return increaseTime(seconds);
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
	'function promptFee() view returns (uint256)',
	'function spendingLimits(address) view returns (uint256 allowance, uint256 spentAmount, uint256 expiresAt)',
]);
const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

async function getLatestBlockTimestamp(): Promise<number> {
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
	const [allowance, spentAmount, expiresAt] = decodeFunctionResult({
		abi: ESCROW_ABI,
		functionName: 'spendingLimits',
		data: result as `0x${string}`,
	}) as [bigint, bigint, bigint];
	return { allowance, spentAmount, expiresAt };
}
