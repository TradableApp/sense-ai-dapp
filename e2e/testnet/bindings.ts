/**
 * Node-side bindings the testnet mock wallet calls instead of touching the chain itself.
 *
 * The page-side script (fixtures/mock-wallet.ts) knows an address and a chain id, nothing else.
 * Reads go through `__mockRpc` → the chain adapter, which refuses dev-node methods, so "no
 * Hardhat RPC method in any request" holds for everything the dApp itself asks the wallet.
 * Signing and sending happen in the keyring with the account's derived key.
 */
import { type BrowserContext, type Page } from '@playwright/test';
import { type Hex } from 'viem';

import { deriveAccounts } from './accounts';
import { registerKey, sendSigned, signMessageFor, signTypedDataFor } from './keyring';
import { getChainConfig, rpc } from '../helpers/chain';

export interface SignableAccount {
	address: string;
	privateKey: `0x${string}`;
}

/** What an injected wallet receives for eth_sendTransaction (hex-quantity fields). */
interface Eip1193Transaction {
	from?: string;
	to?: string;
	data?: Hex;
	value?: Hex;
	gas?: Hex;
}

let shared: SignableAccount | undefined;

/**
 * Testnet counterpart of Hardhat account #1 — the "shared user" behind `authenticatedPage` and
 * the wallet-only fixtures: derived index 0, which the runner's `fund` stage pre-funds.
 */
export function sharedTestnetAccount(): SignableAccount {
	if (!shared) {
		const cfg = getChainConfig();
		if (cfg.chain !== 'testnet') throw new Error('sharedTestnetAccount: testnet only');
		[shared] = deriveAccounts(cfg.seed, 0, 1);
		registerKey(shared.address, shared.privateKey);
	}
	return shared;
}

/**
 * Expose the four bindings on a page or a whole context. The `from` the page sends is ignored
 * in favour of the account this binding was created for: a page cannot promote itself to
 * another signer.
 */
export async function exposeSigningBindings(
	target: Page | BrowserContext,
	account: SignableAccount,
): Promise<void> {
	registerKey(account.address, account.privateKey);
	await target.exposeBinding('__mockRpc', async (_source, method: string, params: unknown[]) =>
		rpc(method, params),
	);
	await target.exposeBinding('__mockPersonalSign', async (_source, message: string) =>
		signMessageFor(account.address, message as Hex),
	);
	await target.exposeBinding('__mockSignTypedData', async (_source, typedData: unknown) =>
		signTypedDataFor(
			account.address,
			typeof typedData === 'string' ? typedData : JSON.stringify(typedData),
		),
	);
	// Returns the hash immediately: the dApp (thirdweb sendAndConfirmTransaction) polls for the
	// receipt itself through eth_getTransactionReceipt, which arrives via __mockRpc.
	await target.exposeBinding('__mockSendTransaction', async (_source, tx: Eip1193Transaction) => {
		if (!tx.to) throw new Error('mock wallet: eth_sendTransaction without `to` is not supported');
		return sendSigned({
			from: account.address,
			to: tx.to,
			data: tx.data,
			value: tx.value ? BigInt(tx.value) : undefined,
			gas: tx.gas ? BigInt(tx.gas) : undefined,
		});
	});
}
