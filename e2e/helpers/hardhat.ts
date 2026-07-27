import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { decodeFunctionResult, encodeFunctionData, parseAbi, toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const execFileAsync = promisify(execFile);
// Sibling repo that owns the contracts + hardhat-upgrades plugin + the OZ upgrades manifest. Anchor on
// THIS file (e2e/helpers/) rather than process.cwd(), so it resolves correctly no matter where
// Playwright is launched from: e2e/helpers → e2e → sense-ai-dapp → <siblings>/tokenized-ai-agent.
const AGENT_REPO_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'tokenized-ai-agent',
);

const RPC_URL = 'http://127.0.0.1:8545';
let reqId = 1;

// ── Per-test fresh accounts ───────────────────────────────────────────────────
// Hardhat's deterministic dev accounts (mnemonic "test test … junk"). Account 0
// is the deployer/oracle and account 1 is the legacy shared user (see
// mock-wallet.ts) — both are RESERVED. Indices 2..249 are derived from the
// mnemonic for per-test "fresh user" isolation: a test that needs a pristine
// history + plan claims one (via helpers/fresh-account.ts) so its on-chain state
// never collides with another test's. The pool is derived rather than hardcoded
// because a full serial run plus retry-spawned workers can consume more than the
// node's 20 prefunded accounts (a full run with retries burned through 58).
// allocateFreshAccount provisions every claim via enableFreshAccount
// (hardhat_setBalance + hardhat_impersonateAccount) — indices ≥ 20 are unusable
// without it.
// PUBLIC Hardhat test keys — NEVER use on any real network.
export interface HardhatAccount {
	address: string;
	privateKey: string;
}

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const FRESH_POOL_FIRST_INDEX = 2;
const FRESH_POOL_LAST_INDEX = 249;

export const FRESH_TEST_ACCOUNTS: readonly HardhatAccount[] = Array.from(
	{ length: FRESH_POOL_LAST_INDEX - FRESH_POOL_FIRST_INDEX + 1 },
	(_, i) => {
		const account = mnemonicToAccount(HARDHAT_MNEMONIC, {
			addressIndex: FRESH_POOL_FIRST_INDEX + i,
		});
		const key = account.getHdKey().privateKey;
		if (!key) {
			throw new Error(
				`fresh-account pool: no private key derived for index ${
					FRESH_POOL_FIRST_INDEX + i
				} — viem HD derivation contract changed?`,
			);
		}
		return {
			address: account.address,
			privateKey: toHex(key),
		};
	},
);

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

/** Dev-node only: make a derived fresh-pool account fully usable. Indices ≥ 20 are
 *  outside the node's default 20 managed accounts, so they need BOTH an ETH balance
 *  (hardhat_setBalance) AND node-side signing rights (hardhat_impersonateAccount —
 *  the mock wallet submits via eth_sendTransaction, which only works for accounts
 *  the node manages or impersonates; without it: "Unknown account 0x…"). */
export async function enableFreshAccount(address: string, wei: bigint): Promise<void> {
	await rpc('hardhat_setBalance', [address, toHex(wei)]);
	await rpc('hardhat_impersonateAccount', [address]);
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

/** Poll the local subgraph's `_meta` head until it reaches `target`, or fail loudly.
 *
 *  This is the serialization that keeps each revert's mini-reorg small; without it
 *  unawaited reorgs queue into a backlog that strands the subgraph and silently kills
 *  answer hydration suite-wide (LOCALNET_SETUP troubleshooting).
 *
 *  It used to be "tolerant": ANY fetch rejection returned immediately, and the abort
 *  was 5s. That made the guard SELF-DISABLING exactly when it was needed — once
 *  graph-node is busy retrying a reorg it answers slowly, the 5s abort trips, the catch
 *  returns, serialization silently stops, and the next revert compounds the backlog.
 *  Observed: the subgraph stranded 59 blocks behind on a FRESH chain while this
 *  function's timeout error never once fired.
 *
 *  Now it separates the two cases:
 *    - graph genuinely absent (connection refused / DNS) → skip once, but SAY SO.
 *      Graph-less contexts (unit-ish specs that revert but never read the subgraph)
 *      must not break.
 *    - graph present but not advancing → keep waiting, then THROW. A stalled
 *      subgraph is the failure this exists to catch; it must never pass silently.
 */
async function waitForGraphHead(target: number, timeoutMs = 120_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let everReachable = false;
	let lastHead: number | null = null;
	let connectionFailures = 0;
	let timeouts = 0;

	while (Date.now() < deadline) {
		// Hoisted so the catch can ask the SIGNAL whether our own timeout fired,
		// rather than trying to identify the error — see the catch for why.
		const signal = AbortSignal.timeout(15_000);
		try {
			const res = await fetch('http://localhost:8000/subgraphs/name/sense-ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: '{_meta{block{number}}}' }),
				// 15s, not 5s: a graph-node mid-reorg is slow to answer, and aborting
				// early is what previously disabled this guard.
				signal,
			});
			// ANY HTTP response proves the endpoint exists, so mark it reachable BEFORE
			// parsing. graph-node can answer with a non-JSON body while starting up; if
			// that parse throw were left to the catch it would be miscounted as a
			// connection failure and could bail as "absent" — an endpoint that just
			// replied to us.
			everReachable = true;
			const body = (await res.json()) as { data?: { _meta?: { block?: { number?: number } } } };
			const head = body.data?._meta?.block?.number;
			// No `_meta` yet (subgraph still deploying) → keep waiting rather than
			// assuming it never will have one.
			if (typeof head === 'number') {
				lastHead = head;
				if (head >= target) return;
			}
		} catch {
			// Distinguish "graph is slow" from "graph is absent" via the SIGNAL, not the
			// error. Error identity is not portable across the runtimes this suite runs
			// under — measured 2026-07-27:
			//
			//                        | Bun            | Node
			//   AbortSignal.timeout  | TimeoutError   | TypeError
			//   AbortController.abort| AbortError     | TypeError
			//   connection refused   | Error          | TypeError
			//
			// so a name check (e.g. `err.name === 'AbortError'`) matches nothing on Bun
			// and cannot discriminate at all on Node. `signal.aborted` is true iff OUR
			// 15s timeout fired, on every runtime.
			if (signal.aborted) {
				// Graph accepted the request but was too slow to answer — that is the
				// STRUGGLING case, i.e. exactly what this guard exists to wait out.
				// Counting it toward "absent" is what made the old guard self-disable.
				timeouts += 1;
			} else {
				// A fast, connection-level rejection (refused / DNS) is real evidence of
				// an absent endpoint. Only bail once we've never had a good answer AND
				// seen several of these; after even one good answer, a later failure
				// means it is struggling, so we keep waiting.
				connectionFailures += 1;
				if (!everReachable && connectionFailures >= 3) {
					console.warn(
						`[revertToSnapshot] subgraph endpoint refused ${connectionFailures} connections — ` +
							'skipping graph re-sync wait (graph-less context). Graph assertions after this ' +
							'revert would read phantom state.',
					);
					return;
				}
			}
		}
		await new Promise(r => setTimeout(r, 500));
	}

	throw new Error(
		`revertToSnapshot: subgraph did not re-sync to block ${target} within ${timeoutMs}ms ` +
			`(last observed head: ${lastHead ?? 'none'}${
				everReachable ? '' : ', endpoint never answered'
			}, ${timeouts} request timeout(s), ${connectionFailures} connection failure(s)) — ` +
			'graph-node reorg backlog; see LOCALNET_SETUP troubleshooting.',
	);
}

export async function revertToSnapshot(snapshotId: string): Promise<void> {
	// evm_revert rewinds the CHAIN but not graph-node: its high-water mark stays at
	// the orphaned timeline's head, so waitForIndexing() no-ops (already "past" the
	// target block) and entities from the new timeline never index — every graph
	// assertion after a bare revert reads PHANTOM pre-revert state. Mine the new
	// timeline past the old head so graph-node detects the longer canonical chain
	// and reorgs onto it.
	const preRevertHead = await getBlockNumber();
	await rpc('evm_revert', [snapshotId]);
	const postRevertHead = await getBlockNumber();
	if (preRevertHead > postRevertHead) {
		await mineBlocks(preRevertHead - postRevertHead + 2);
		// …and WAIT for graph-node to unwind + re-sync before the next test runs.
		// Its reorg machinery processes one block per operation: dozens of
		// unawaited mini-reorgs queue into an hours-long backlog that strands the
		// subgraph far behind the chain (observed: 66 blocks), after which answer
		// hydration — which reads through the subgraph — silently dies suite-wide.
		// Serializing here keeps each unwind small (seconds) and the subgraph
		// current for every later spec. Skipped gracefully if the graph isn't up.
		await waitForGraphHead(await getBlockNumber());
	}
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
	// The deployer's ABLE supply is finite PER CHAIN: every fresh-account claim
	// transfers some away, and heavy live-chain rerunning can drain it to zero.
	// When that happens plan activation fails silently and specs die with an
	// opaque "composer not found" — fail loudly at the source instead.
	const balData = `0x70a08231${padAddress(DEPLOYER_ADDRESS).slice(2)}`;
	const balHex = (await rpc('eth_call', [{ to: tokenAddress, data: balData }, 'latest'])) as string;
	if (BigInt(balHex) < amount) {
		throw new Error(
			`fundABLE: deployer ABLE depleted (${BigInt(balHex)} < ${amount}). ` +
				'The chain has been reused past its token supply — restart the stack ' +
				'(sense-ai-e2e: stop-e2e.sh + start-e2e.sh) for a fresh chain.',
		);
	}
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
	'function transferOwnership(address newOwner)',
	'function promptFee() view returns (uint256)',
	'function treasury() view returns (address)',
	'function owner() view returns (address)',
	'function spendingLimits(address) view returns (uint256 allowance, uint256 spentAmount, uint256 expiresAt)',
	'function processRefund(uint256 _answerMessageId)',
]);
const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);
// EVMAIAgent owns the oracle address (setOracle / OracleUpdated → subgraph ProtocolConfig.oracle).
const AGENT_ABI = parseAbi([
	'function oracle() view returns (address)',
	'function setOracle(address _newOracle)',
]);

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

/** Read the current owner of an Ownable contract (escrow or agent). */
export async function getOwner(contractAddress: string): Promise<string> {
	const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: 'owner', args: [] });
	const result = await callContract(contractAddress, data);
	return `0x${result.slice(-40)}`;
}

/**
 * Transfer ownership of an Ownable contract (single-step OwnableUpgradeable).
 * @param fromAddress the CURRENT owner sending the tx (defaults to the deployer/owner, account 0).
 */
export async function transferOwnership(
	contractAddress: string,
	newOwner: string,
	fromAddress: string = DEPLOYER_ADDRESS,
): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'transferOwnership',
		args: [newOwner as `0x${string}`],
	});
	await sendFrom(fromAddress, contractAddress, data);
}

/**
 * Set the per-prompt fee as a SPECIFIC sender (not the default deployer) — used to assert that the
 * new owner can set fees and the old owner can no longer (the call reverts and this promise rejects).
 */
export async function setPromptFeeFrom(
	escrowAddress: string,
	fromAddress: string,
	newFee: bigint,
): Promise<void> {
	const data = encodeFunctionData({
		abi: ESCROW_ABI,
		functionName: 'setPromptFee',
		args: [newFee],
	});
	await sendFrom(fromAddress, escrowAddress, data);
}

/**
 * Upgrade the localnet EVMAIAgentEscrow UUPS proxy to its V2 implementation by shelling out to the
 * tokenized-ai-agent repo's hardhat-upgrades script. The upgrade MUST run inside that Hardhat project
 * (the upgrades plugin + the OZ manifest written by `deploy:base-localnet` live there) — it can't be
 * driven raw from here. The proxy address + storage are unchanged; only the implementation swaps.
 */
export async function upgradeEscrowToV2(escrowAddress: string): Promise<void> {
	try {
		await execFileAsync('bun', ['run', 'upgrade:base-localnet-v2'], {
			cwd: AGENT_REPO_DIR,
			env: { ...process.env, PROXY_ADDRESS: escrowAddress, UPGRADE_TARGET: 'escrow' },
			timeout: 120_000,
		});
	} catch (err: unknown) {
		// execFile's error message is a generic "Command failed"; the real Hardhat output lives on
		// stderr/stdout — surface it so the Playwright reporter shows why the upgrade failed.
		const e = err as { stderr?: string; stdout?: string };
		throw new Error(`upgradeEscrowToV2 failed:\n${e.stderr || e.stdout || ''}`, { cause: err });
	}
}

/** Read the current on-chain oracle address from the EVMAIAgent. */
export async function getOracle(agentAddress: string): Promise<string> {
	const data = encodeFunctionData({ abi: AGENT_ABI, functionName: 'oracle', args: [] });
	const result = await callContract(agentAddress, data);
	return `0x${result.slice(-40)}`;
}

/**
 * Rotate the on-chain oracle address (owner-only on EVMAIAgent). Sent by the deployer/owner
 * (account 0). NOTE: the running localnet oracle keeps DECRYPTING with its signer key, but answer
 * submission is onlyOracle-gated — so once rotated it can no longer SUBMIT, and any in-flight prompt
 * is orphaned (see T-GOV-ORACLE-02). Restore the original address afterwards so the stack stays clean.
 */
export async function setOracle(
	agentAddress: string,
	newOracle: string,
	fromAddress: string = DEPLOYER_ADDRESS,
): Promise<void> {
	const data = encodeFunctionData({
		abi: AGENT_ABI,
		functionName: 'setOracle',
		args: [newOracle as `0x${string}`],
	});
	await sendFrom(fromAddress, agentAddress, data);
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
