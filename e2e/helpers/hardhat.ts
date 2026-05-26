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
	return `0x${  address.replace('0x', '').toLowerCase().padStart(64, '0')}`;
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
