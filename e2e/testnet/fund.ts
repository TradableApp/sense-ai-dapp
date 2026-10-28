/**
 * `bun run e2e:testnet:fund` — the run-day runner's `fund` stage.
 *
 * Derives the pre-funded accounts (indices 0..E2E_TESTNET_ACCOUNT_COUNT-1) from the run seed,
 * checks the treasury can afford them, funds each with ETH + ABLE, and writes the accounts file
 * (addresses only). Index 0 doubles as the shared "user" for the cached-auth fixtures and as the
 * oracle smoke's sender (`key -- 0`).
 *
 * Reads the runner's E2E_TESTNET_* contract from the environment; never prints a key, the seed
 * or the provider URL.
 */
// A module (not a script) so each file's `main` is its own; testnet-only by construction.
export {};

process.env.E2E_CHAIN ??= 'testnet';

async function main(): Promise<void> {
	const { loadChainEnv } = await import('../helpers/env');
	loadChainEnv();
	const { redactUrl } = await import('../helpers/chain');
	const {
		appendAccountsFile,
		assertTreasuryCanFund,
		deriveAndRegister,
		ethBalance,
		ETH_PER_ACCOUNT_WEI,
		fundAccount,
		testnetConfig,
		tokenBalance,
		TOKEN_PER_ACCOUNT_WEI,
	} = await import('./treasury');

	const cfg = testnetConfig();
	console.log(
		`fund: chain ${cfg.chainId} via ${redactUrl(cfg.rpcUrl)}, treasury ${cfg.treasuryAddress}, ` +
			`${cfg.prefundedCount} account(s) × ${Number(ETH_PER_ACCOUNT_WEI) / 1e18} ETH + ` +
			`${Number(TOKEN_PER_ACCOUNT_WEI) / 1e18} ABLE`,
	);
	await assertTreasuryCanFund(cfg.prefundedCount);

	const accounts = deriveAndRegister(0, cfg.prefundedCount);
	// Recorded BEFORE funding so a half-funded account is still swept.
	await appendAccountsFile(
		cfg.accountsFile,
		accounts.map(({ index, address }) => ({ index, address })),
	);
	for (const account of accounts) {
		await fundAccount(account.address);
		console.log(
			`fund: #${account.index} ${account.address} ← ` +
				`${Number(await ethBalance(account.address)) / 1e18} ETH, ` +
				`${Number(await tokenBalance(account.address)) / 1e18} ABLE`,
		);
	}
	console.log(`fund: wrote ${cfg.accountsFile}`);
}

main().catch((err: unknown) => {
	console.error(`fund: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
