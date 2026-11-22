/**
 * Transfers the fee token (any ERC-20 at VITE_TOKEN_CONTRACT_ADDRESS, read with its own decimals
 * and labelled with its own symbol) from a funded wallet to a recipient. A fee token that moves
 * only to or from its owner or an address the owner has listed needs the sender or the
 * recipient to be one of those.
 * Intended for localnet and testnet setup — funded test wallets for E2E testing.
 *
 * Run via:
 *   bun run fund:localnet
 *   bun run fund:testnet
 *
 * Required env vars (loaded from the --env-file for the chosen network):
 *   VITE_TOKEN_CONTRACT_ADDRESS  — the fee token's proxy address
 *   VITE_RPC_URL                 — JSON-RPC endpoint
 *   FUND_PRIVATE_KEY             — sender private key (must hold enough of the token)
 *   FUND_RECIPIENT               — recipient address
 *
 * Optional:
 *   FUND_AMOUNT                  — amount in whole tokens (default: 100)
 *   FUND_NETWORK                 — chain name surfaced to viem (default: "chain-{chainId}")
 *
 * Localnet defaults (Hardhat Account #0 key is publicly known — safe to use here):
 *   FUND_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   FUND_RECIPIENT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   (Hardhat Account #1)
 *   VITE_RPC_URL=http://127.0.0.1:8545
 */

import {
	createPublicClient,
	createWalletClient,
	formatUnits,
	http,
	isAddress,
	parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Minimal ABI — `decimals` is read so the script handles non-18-decimal tokens correctly, and
// `symbol` so the console lines name the token actually sent.
const ERC20_ABI = [
	{
		name: 'transfer',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		name: 'balanceOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		name: 'decimals',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint8' }],
	},
	{
		name: 'symbol',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'string' }],
	},
];

async function main() {
	const tokenAddress = process.env.VITE_TOKEN_CONTRACT_ADDRESS;
	const rpcUrl = process.env.VITE_RPC_URL || 'http://127.0.0.1:8545';
	const privateKey = process.env.FUND_PRIVATE_KEY;
	const recipient = process.env.FUND_RECIPIENT;
	const amount = process.env.FUND_AMOUNT || '100';

	if (!tokenAddress) throw new Error('VITE_TOKEN_CONTRACT_ADDRESS is not set.');
	if (!privateKey) throw new Error('FUND_PRIVATE_KEY is not set.');
	if (!recipient) throw new Error('FUND_RECIPIENT is not set.');
	if (!isAddress(recipient)) throw new Error(`FUND_RECIPIENT is not a valid address: ${recipient}`);
	if (!isAddress(tokenAddress))
		throw new Error(`VITE_TOKEN_CONTRACT_ADDRESS is not a valid address: ${tokenAddress}`);

	const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
	let account;
	try {
		account = privateKeyToAccount(key);
	} catch {
		// The library's message can quote part of the value; this one never does.
		throw new Error('FUND_PRIVATE_KEY is not a valid private key.');
	}

	const transport = http(rpcUrl);
	const publicClient = createPublicClient({ transport });
	const walletClient = createWalletClient({ account, transport });

	const chainId = await publicClient.getChainId();

	const readArgs = { address: tokenAddress, abi: ERC20_ABI };

	const decimals = await publicClient.readContract({ ...readArgs, functionName: 'decimals' });
	const symbol = await publicClient.readContract({ ...readArgs, functionName: 'symbol' });

	console.log(`\n--- Fund ${symbol} ---`);
	console.log(`  Network:   chainId ${chainId}`);
	console.log(`  Token:     ${tokenAddress}`);
	console.log(`  Sender:    ${account.address}`);
	console.log(`  Recipient: ${recipient}`);
	console.log(`  Amount:    ${amount} ${symbol}`);

	const senderBefore = await publicClient.readContract({
		...readArgs,
		functionName: 'balanceOf',
		args: [account.address],
	});
	const recipientBefore = await publicClient.readContract({
		...readArgs,
		functionName: 'balanceOf',
		args: [recipient],
	});

	console.log(`\n  Sender balance before:    ${formatUnits(senderBefore, decimals)} ${symbol}`);
	console.log(`  Recipient balance before: ${formatUnits(recipientBefore, decimals)} ${symbol}`);

	const amountWei = parseUnits(amount, decimals);
	if (senderBefore < amountWei) {
		throw new Error(
			`Insufficient balance. Sender has ${formatUnits(
				senderBefore,
				decimals,
			)} ${symbol}, needs ${amount}.`,
		);
	}

	console.log('\nSending transaction...');
	const hash = await walletClient.writeContract({
		address: tokenAddress,
		abi: ERC20_ABI,
		functionName: 'transfer',
		args: [recipient, amountWei],
		chain: {
			id: chainId,
			name: process.env.FUND_NETWORK || `chain-${chainId}`,
			nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
			rpcUrls: { default: { http: [rpcUrl] } },
		},
	});

	await publicClient.waitForTransactionReceipt({ hash });

	const recipientAfter = await publicClient.readContract({
		...readArgs,
		functionName: 'balanceOf',
		args: [recipient],
	});

	console.log(`\n✅ Transfer complete.  tx: ${hash}`);
	console.log(`  Recipient balance after: ${formatUnits(recipientAfter, decimals)} ${symbol}`);
}

// A provider URL can carry an API key, and viem puts the request URL in its error messages: print
// the short message with any URL and any key-length hex run replaced.
function scrubbed(error) {
	const text = String(error?.shortMessage ?? error?.message ?? error);
	return text
		.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
		.replace(/(?:0x)?[0-9a-f]{64,}/gi, '<hex>');
}

main().catch(e => {
	console.error(`\n❌ ${scrubbed(e)}`);
	process.exit(1);
});
