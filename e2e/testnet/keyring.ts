/**
 * In-process keyring for testnet mode. Holds the private keys of the accounts THIS process may
 * sign for — the treasury (from the runner's env) and the ephemeral accounts it has derived —
 * and signs with viem. Keys never leave the process: nothing here writes, logs or returns them
 * except `privateKeyFor`, whose only caller is the `key` script the runner captures in-process.
 *
 * On localnet none of this is used: the node signs for unlocked or impersonated accounts.
 */
import {
	type Chain,
	createWalletClient,
	defineChain,
	type Hex,
	http,
	nonceManager,
	type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getChainConfig, type SendFromRequest } from '../helpers/chain';

const keys = new Map<string, Hex>();
const wallets = new Map<string, WalletClient>();
let chainDef: Chain | undefined;

const norm = (address: string): string => address.toLowerCase();

export function registerKey(address: string, privateKey: Hex): void {
	keys.set(norm(address), privateKey);
}

/** The key for `address`: a derived ephemeral account or the treasury. Throws by ADDRESS only. */
export function privateKeyFor(address: string): Hex {
	const cfg = getChainConfig();
	if (cfg.chain !== 'testnet') throw new Error('keyring: only used on testnet');
	if (norm(address) === norm(cfg.treasuryAddress)) return cfg.treasuryPrivateKey;
	const key = keys.get(norm(address));
	if (!key) {
		throw new Error(
			`keyring: no key for ${address} — on testnet an account must be derived from the run ` +
				'seed (fresh-account allocator) or be the treasury before it can sign.',
		);
	}
	return key;
}

/** Base Sepolia (or whatever the runner points at) as a viem chain, from the adapter config. */
export function viemChain(): Chain {
	if (chainDef) return chainDef;
	const cfg = getChainConfig();
	chainDef = defineChain({
		id: cfg.chainId,
		name: `e2e-${cfg.chain}-${cfg.chainId}`,
		nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
		rpcUrls: { default: { http: [cfg.rpcUrl] } },
	});
	return chainDef;
}

/**
 * A wallet client for `address`, cached per address so viem's nonce manager sees every send
 * from one account in one place. Serialising sends across PROCESSES (fund script, then the
 * Playwright worker) is the allocator's file lock; within a process this is enough.
 */
export function walletFor(address: string): WalletClient {
	const cached = wallets.get(norm(address));
	if (cached) return cached;
	const account = privateKeyToAccount(privateKeyFor(address), { nonceManager });
	const client = createWalletClient({
		account,
		chain: viemChain(),
		transport: http(getChainConfig().rpcUrl),
	});
	wallets.set(norm(address), client);
	return client;
}

/** Sign and broadcast; returns the hash. The adapter's `sendFrom` waits for the receipt. */
export async function sendSigned(req: SendFromRequest): Promise<Hex> {
	const client = walletFor(req.from);
	if (!client.account) throw new Error('keyring: wallet client has no account');
	return client.sendTransaction({
		account: client.account,
		chain: viemChain(),
		to: req.to as Hex,
		data: req.data,
		value: req.value,
		gas: req.gas,
		maxFeePerGas: req.maxFeePerGas,
		maxPriorityFeePerGas: req.maxPriorityFeePerGas,
	});
}

/** EIP-191 personal_sign of raw bytes (the dApp signs a fixed hex message for its session key). */
export async function signMessageFor(address: string, raw: Hex): Promise<Hex> {
	return privateKeyToAccount(privateKeyFor(address)).signMessage({ message: { raw } });
}

/** EIP-712 typed data as an injected wallet receives it: the JSON string from the dApp. */
export async function signTypedDataFor(address: string, typedDataJson: string): Promise<Hex> {
	const typed = JSON.parse(typedDataJson) as Parameters<
		ReturnType<typeof privateKeyToAccount>['signTypedData']
	>[0];
	return privateKeyToAccount(privateKeyFor(address)).signTypedData(typed);
}
