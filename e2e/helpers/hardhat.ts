/**
 * Hardhat JSON-RPC helpers for use in Playwright tests.
 * These run in Node.js (not the browser), calling the Hardhat node directly.
 */

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

/** Returns the current block number */
export async function getBlockNumber(): Promise<number> {
	const hex = (await rpc('eth_blockNumber')) as string;
	return parseInt(hex, 16);
}

/** Returns the ETH balance of an address in wei (as BigInt) */
export async function getBalance(address: string): Promise<bigint> {
	const hex = (await rpc('eth_getBalance', [address, 'latest'])) as string;
	return BigInt(hex);
}

/** Mines a given number of empty blocks instantly */
export async function mineBlocks(count: number): Promise<void> {
	await rpc('hardhat_mine', [`0x${count.toString(16)}`]);
}

/** Increases the EVM clock by `seconds` without mining a block */
export async function increaseTime(seconds: number): Promise<void> {
	await rpc('evm_increaseTime', [seconds]);
	await rpc('evm_mine', []);
}

/** Takes an EVM snapshot and returns the snapshot ID */
export async function takeSnapshot(): Promise<string> {
	return (await rpc('evm_snapshot')) as string;
}

/** Reverts to a previously taken EVM snapshot */
export async function revertToSnapshot(snapshotId: string): Promise<void> {
	await rpc('evm_revert', [snapshotId]);
}

/** Returns true if the Hardhat node is reachable */
export async function isHardhatRunning(): Promise<boolean> {
	try {
		await getBlockNumber();
		return true;
	} catch {
		return false;
	}
}
