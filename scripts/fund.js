/**
 * Transfers ABLE tokens from a funded wallet to a recipient.
 * Intended for localnet and testnet setup — funded test wallets for E2E testing.
 *
 * Run via:
 *   bun run fund:localnet
 *   bun run fund:testnet
 *
 * Required env vars (loaded from the --env-file for the chosen network):
 *   VITE_TOKEN_CONTRACT_ADDRESS  — AbleToken proxy address
 *   VITE_RPC_URL                 — JSON-RPC endpoint
 *   FUND_PRIVATE_KEY             — sender private key (must hold sufficient ABLE)
 *   FUND_RECIPIENT               — recipient address
 *
 * Optional:
 *   FUND_AMOUNT                  — amount in ABLE (default: 100)
 *
 * Localnet defaults (Hardhat Account #0 key is publicly known — safe to use here):
 *   FUND_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   FUND_RECIPIENT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   (Hardhat Account #1)
 *   VITE_RPC_URL=http://127.0.0.1:8545
 */

import {
	createPublicClient,
	createWalletClient,
	http,
	parseEther,
	formatEther,
	isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Minimal ABI — only the two ERC-20 functions we need.
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
	const account = privateKeyToAccount(key);

	const transport = http(rpcUrl);
	const publicClient = createPublicClient({ transport });
	const walletClient = createWalletClient({ account, transport });

	const chainId = await publicClient.getChainId();

	console.log(`\n--- Fund ABLE tokens ---`);
	console.log(`  Network:   chainId ${chainId} (${rpcUrl})`);
	console.log(`  Token:     ${tokenAddress}`);
	console.log(`  Sender:    ${account.address}`);
	console.log(`  Recipient: ${recipient}`);
	console.log(`  Amount:    ${amount} ABLE`);

	const readArgs = { address: tokenAddress, abi: ERC20_ABI };

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

	console.log(`\n  Sender balance before:    ${formatEther(senderBefore)} ABLE`);
	console.log(`  Recipient balance before: ${formatEther(recipientBefore)} ABLE`);

	const amountWei = parseEther(amount);
	if (senderBefore < amountWei) {
		throw new Error(
			`Insufficient balance. Sender has ${formatEther(senderBefore)} ABLE, needs ${amount}.`,
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
			name: 'localnet',
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
	console.log(`  Recipient balance after: ${formatEther(recipientAfter)} ABLE`);
}

main().catch(e => {
	console.error(`\n❌ ${e.message}`);
	process.exit(1);
});
