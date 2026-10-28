/**
 * Chain adapter — the one place the e2e suite decides WHICH chain it is on and what that chain
 * allows.
 *
 * Localnet (default) is the Hardhat stack brought up by sense-ai-e2e: accounts are unlocked or
 * impersonated on the node, so `eth_sendTransaction` works and the dev-node namespaces
 * (`hardhat_*`, `evm_*`) are available. Testnet is Base Sepolia reached through a provider:
 * nothing is unlocked, every transaction is signed in Node, and a dev-node method is a bug.
 *
 * This module holds the PURE decisions (tested in chain.test.ts) plus the two network primitives
 * the rest of the helpers build on: `rpc()` and `sendFrom()`. Chain-specific signing lives in
 * `../testnet/keyring.ts`; funding and sweeping in `../testnet/treasury.ts`.
 */
import { isAddress } from 'viem';

export type ChainName = 'localnet' | 'testnet';

const CHAIN_NAMES: readonly ChainName[] = ['localnet', 'testnet'];
const LOCALNET_CHAIN_ID = 31337;
const LOCALNET_RPC_URL = 'http://127.0.0.1:8545';
const LOCALNET_BASE_URL = 'http://localhost:3002';
const DEFAULT_PREFUNDED_COUNT = 4;
/** The hosted testnet build (sense-ai-e2e TESTNET_DAPP_URL default). The runner exports
 *  E2E_BASE_URL for the Playwright stage; the fund/key/sweep scripts never open a browser. */
const TESTNET_DEFAULT_BASE_URL = 'https://sense-ai-app-garrick.web.app';

/** Environment subset the adapter reads. `NodeJS.ProcessEnv`-shaped so `process.env` passes. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * `E2E_CHAIN` names the chain outright; the run-day runner sets `E2E_TESTNET=1` instead. An
 * explicit name wins so a developer can force localnet inside a testnet shell.
 */
export function resolveChain(env: Env): ChainName {
	const explicit = env.E2E_CHAIN;
	if (explicit !== undefined && explicit !== '') {
		if ((CHAIN_NAMES as readonly string[]).includes(explicit)) return explicit as ChainName;
		throw new Error(
			`E2E_CHAIN="${explicit}" is not a chain this suite knows — use one of ${CHAIN_NAMES.join(
				', ',
			)}.`,
		);
	}
	return env.E2E_TESTNET === '1' ? 'testnet' : 'localnet';
}

/**
 * Whether a real stack is behind the dApp. On localnet that is opt-in (`E2E_LOCAL_SERVICES=1`,
 * the Hardhat + graph-node + oracle stack); on testnet it is always true because the stack is
 * real infrastructure. Specs gate on this rather than on the localnet flag directly.
 */
export function isLiveStack(env: Env): boolean {
	return resolveChain(env) === 'testnet' || env.E2E_LOCAL_SERVICES === '1';
}

/** Dev-node namespaces that do not exist on a public chain. */
const DEV_NODE_METHOD = /^(hardhat_|evm_|anvil_|debug_|miner_)/;
/** Needs an unlocked account on the node; nothing is unlocked on a public chain. */
const UNLOCKED_ACCOUNT_METHODS = new Set(['eth_sendTransaction', 'eth_sign']);

/**
 * Throws on testnet for any method that only a dev node can answer. Called on every request the
 * suite makes, Node-side and from the mock wallet's binding, so "no Hardhat RPC method in any
 * request" is enforced at runtime rather than hoped for.
 */
export function assertRpcMethodAllowed(chain: ChainName, method: string): void {
	if (chain === 'localnet') return;
	if (DEV_NODE_METHOD.test(method) || UNLOCKED_ACCOUNT_METHODS.has(method)) {
		throw new Error(
			`${method} is a dev-node method and cannot be used on testnet — the suite must sign in ` +
				'Node and send raw transactions. Route the call through the chain adapter.',
		);
	}
}

interface BaseChainConfig {
	chainId: number;
	rpcUrl: string;
	tokenAddress: string;
	escrowAddress: string;
	agentAddress: string;
	/** Where Playwright points the browser. */
	baseUrl: string;
}

export interface LocalnetConfig extends BaseChainConfig {
	chain: 'localnet';
}

export interface TestnetConfig extends BaseChainConfig {
	chain: 'testnet';
	treasuryAddress: string;
	treasuryPrivateKey: `0x${string}`;
	/** 32 bytes of hex (no 0x) — the per-run seed every ephemeral account derives from. */
	seed: string;
	/** JSON `[{index, address}]` the runner reads back to verify the sweep. */
	accountsFile: string;
	/** Accounts the runner's `fund` stage pre-funds (indices 0..n-1). */
	prefundedCount: number;
}

export type ChainConfig = LocalnetConfig | TestnetConfig;

const HEX_32_BYTES = /^(0x)?[0-9a-fA-F]{64}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * The testnet contract, as the runner (sense-ai-e2e `run-e2e-testnet.sh`) exports it. Every
 * problem is collected and reported ONCE, by variable NAME only — never by value, because three
 * of these are secrets and the message ends up in a log.
 */
function readTestnetConfig(env: Env): TestnetConfig {
	const problems: string[] = [];
	const need = (name: string): string => {
		const value = env[name];
		if (value === undefined || value === '') problems.push(`${name} is not set`);
		return value ?? '';
	};
	const chainIdRaw = need('E2E_TESTNET_CHAIN_ID');
	const rpcUrl = need('E2E_TESTNET_RPC_URL');
	const tokenAddress = need('E2E_TESTNET_TOKEN_ADDRESS');
	const treasuryAddress = need('E2E_TESTNET_TREASURY_ADDRESS');
	const treasuryPrivateKey = need('E2E_TESTNET_TREASURY_PRIVATE_KEY');
	const seed = need('E2E_TESTNET_SEED');
	const accountsFile = need('E2E_TESTNET_ACCOUNTS_FILE');
	const baseUrl = env.E2E_BASE_URL || TESTNET_DEFAULT_BASE_URL;
	const escrowAddress = need('VITE_ESCROW_CONTRACT_ADDRESS');
	const agentAddress = need('VITE_AGENT_CONTRACT_ADDRESS');
	const countRaw = env.E2E_TESTNET_ACCOUNT_COUNT ?? String(DEFAULT_PREFUNDED_COUNT);

	const chainId = Number(chainIdRaw);
	if (chainIdRaw !== '' && (!Number.isInteger(chainId) || chainId <= 0)) {
		problems.push('E2E_TESTNET_CHAIN_ID is not a positive integer');
	}
	const prefundedCount = Number(countRaw);
	if (!Number.isInteger(prefundedCount) || prefundedCount <= 0) {
		problems.push('E2E_TESTNET_ACCOUNT_COUNT is not a positive integer');
	}
	if (treasuryPrivateKey !== '' && !PRIVATE_KEY.test(treasuryPrivateKey)) {
		problems.push('E2E_TESTNET_TREASURY_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key');
	}
	if (seed !== '' && !HEX_32_BYTES.test(seed)) {
		problems.push('E2E_TESTNET_SEED is not 32 bytes of hex');
	}
	for (const [name, value] of [
		['E2E_TESTNET_TOKEN_ADDRESS', tokenAddress],
		['E2E_TESTNET_TREASURY_ADDRESS', treasuryAddress],
		['VITE_ESCROW_CONTRACT_ADDRESS', escrowAddress],
		['VITE_AGENT_CONTRACT_ADDRESS', agentAddress],
	] as const) {
		if (value !== '' && !isAddress(value)) problems.push(`${name} is not a valid address`);
	}
	if (rpcUrl !== '' && !/^https?:\/\//.test(rpcUrl)) {
		problems.push('E2E_TESTNET_RPC_URL is not an http(s) URL');
	}

	if (problems.length > 0) {
		throw new Error(
			`Testnet mode is missing or malformed configuration:\n  - ${problems.join('\n  - ')}\n` +
				'These come from sense-ai-e2e run-e2e-testnet.sh (after sync-config.sh) plus the dApp .env.testnet.',
		);
	}

	return {
		chain: 'testnet',
		chainId,
		rpcUrl,
		tokenAddress,
		escrowAddress,
		agentAddress,
		baseUrl,
		treasuryAddress,
		treasuryPrivateKey: treasuryPrivateKey as `0x${string}`,
		seed: seed.replace(/^0x/, ''),
		accountsFile,
		prefundedCount,
	};
}

function readLocalnetConfig(env: Env): LocalnetConfig {
	return {
		chain: 'localnet',
		chainId: LOCALNET_CHAIN_ID,
		rpcUrl: env.VITE_CHAIN_RPC_URL || LOCALNET_RPC_URL,
		tokenAddress: env.VITE_TOKEN_CONTRACT_ADDRESS ?? '',
		escrowAddress: env.VITE_ESCROW_CONTRACT_ADDRESS ?? '',
		agentAddress: env.VITE_AGENT_CONTRACT_ADDRESS ?? '',
		baseUrl: env.E2E_BASE_URL || LOCALNET_BASE_URL,
	};
}

/** Validates once and fails fast; on localnet it is lenient because the mocked (no-stack) run
 *  has no addresses at all and must still load. */
export function readChainConfig(env: Env): ChainConfig {
	return resolveChain(env) === 'testnet' ? readTestnetConfig(env) : readLocalnetConfig(env);
}

/** EIP-155 id as an injected wallet reports it (`eth_chainId`). */
export function chainIdHex(chainId: number): string {
	return `0x${chainId.toString(16)}`;
}

/** Provider URLs embed the API key in the path; keep the host, drop the rest. Never throws. */
export function redactUrl(url: string): string {
	try {
		return `${new URL(url).origin}/…`;
	} catch {
		return '<unparseable url>';
	}
}

// ── Process-wide selection ────────────────────────────────────────────────────────────────────

/** The chain this process is testing. Fixed at import; set by the runner or the developer. */
export const CHAIN: ChainName = resolveChain(process.env);
/** Whether specs that need a real stack should run. Replaces the raw localnet flag reads. */
export const LIVE_STACK: boolean = isLiveStack(process.env);
/** Skip message for specs that need a live stack, worded for whichever stack is absent. */
export const LIVE_STACK_SKIP_REASON =
	CHAIN === 'testnet'
		? 'Skipped: testnet mode expects the Base Sepolia stack (runner env missing?)'
		: 'Skipped: requires the local Hardhat + oracle + Graph stack (set E2E_LOCAL_SERVICES=1)';

let cachedConfig: ChainConfig | undefined;
/** Memoised so a malformed testnet env fails on first use with ONE message, not on import. */
export function getChainConfig(): ChainConfig {
	if (cachedConfig === undefined) cachedConfig = readChainConfig(process.env);
	return cachedConfig;
}

// ── Network primitives ────────────────────────────────────────────────────────────────────────

interface JsonRpcResponse {
	result?: unknown;
	error?: { message?: string; code?: number };
}

let reqId = 1;

/**
 * One JSON-RPC call to the current chain. Every Node-side helper and the testnet mock wallet's
 * binding go through here, so the method allow-list is enforced for all of them.
 */
export async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
	assertRpcMethodAllowed(CHAIN, method);
	const { rpcUrl } = getChainConfig();
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }),
	});
	const json = (await res.json()) as JsonRpcResponse;
	if (json.error) {
		// The URL is NOT included: on testnet it carries the provider key.
		throw new Error(`RPC error (${CHAIN}, ${method}): ${json.error.message ?? 'unknown'}`);
	}
	return json.result;
}

export async function waitForReceipt(txHash: string, timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const receipt = (await rpc('eth_getTransactionReceipt', [txHash])) as {
			status?: string;
		} | null;
		if (receipt) {
			if (receipt.status === '0x0') throw new Error(`Transaction ${txHash} reverted`);
			return;
		}
		await new Promise(resolve => {
			setTimeout(resolve, CHAIN === 'testnet' ? 1_000 : 250);
		});
	}
	throw new Error(`Transaction ${txHash} not mined within ${timeoutMs}ms`);
}

export interface SendFromRequest {
	from: string;
	to: string;
	data?: `0x${string}`;
	value?: bigint;
	/** Testnet only: explicit limits so a sweep's fee arithmetic is an upper bound. */
	gas?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
}

/**
 * Move chain time forward by `seconds`. Localnet: `evm_increaseTime` + a mined block. Testnet:
 * wall-clock wait — a public chain's `block.timestamp` advances on its own (Base: 2 s blocks),
 * so for the short protocol windows (the 3 s cancellation timeout) waiting IS advancing. Long
 * windows (the 1 h refund timeout) are not reachable this way; those specs stay localnet-only.
 */
export async function advanceTime(seconds: number): Promise<void> {
	if (CHAIN === 'localnet') {
		await rpc('evm_increaseTime', [seconds]);
		await rpc('evm_mine', []);
		return;
	}
	await new Promise(resolve => {
		setTimeout(resolve, seconds * 1_000);
	});
}

/** True when the configured RPC answers and reports the configured chain id. */
export async function isChainReachable(): Promise<boolean> {
	try {
		const id = (await rpc('eth_chainId')) as string;
		return parseInt(id, 16) === getChainConfig().chainId;
	} catch {
		return false;
	}
}

/**
 * Send a transaction AS `from` and wait for it to mine. Localnet: the node has the account
 * unlocked or impersonated, so `eth_sendTransaction`. Testnet: the keyring must hold the key
 * (treasury or a seed-derived ephemeral account); it signs in Node and sends raw.
 */
export async function sendFrom(req: SendFromRequest): Promise<string> {
	if (CHAIN === 'localnet') {
		const tx: Record<string, string> = { from: req.from, to: req.to };
		if (req.data) tx.data = req.data;
		if (req.value !== undefined) tx.value = `0x${req.value.toString(16)}`;
		const hash = (await rpc('eth_sendTransaction', [tx])) as string;
		await waitForReceipt(hash);
		return hash;
	}
	// Lazy import keeps the localnet path free of the testnet signing stack.
	const { sendSigned } = await import('../testnet/keyring');
	const hash = await sendSigned(req);
	await waitForReceipt(hash);
	return hash;
}
