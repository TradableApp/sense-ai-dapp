/**
 * `bun run e2e:testnet:sweep` — the run-day runner's `sweep` stage (and its exit trap).
 *
 * Re-derives every account the accounts file lists from the run seed, verifies each derived
 * address matches the recorded one (a mismatch means a different seed — refuse rather than
 * sign with the wrong key), and returns each account's ABLE then ETH to the treasury. One
 * account's failure does not stop the others; the exit code reports any failure, and the
 * runner's own balance read (verify_swept) is the verdict, not this script's report.
 */
// A module (not a script) so each file's `main` is its own; testnet-only by construction.
export {};

process.env.E2E_CHAIN ??= 'testnet';

async function main(): Promise<void> {
	const { loadChainEnv } = await import('../helpers/env');
	loadChainEnv();
	const { deriveAndRegister, readAccountsFile, sweepAccount, testnetConfig } = await import(
		'./treasury'
	);

	const cfg = testnetConfig();
	const records = readAccountsFile(cfg.accountsFile);
	if (records.length === 0) {
		console.log(`sweep: ${cfg.accountsFile} lists no accounts — nothing to return`);
		return;
	}
	let failures = 0;
	for (const record of records) {
		const [derived] = deriveAndRegister(record.index, 1);
		if (derived.address.toLowerCase() !== record.address.toLowerCase()) {
			failures += 1;
			console.error(
				`sweep: #${record.index} ${record.address} does not derive from this run's seed — ` +
					'refusing; sweep it by hand with the seed that funded it',
			);
		} else {
			try {
				const plan = await sweepAccount(record.address);
				console.log(
					`sweep: #${record.index} ${record.address} → treasury ` +
						`(token: ${plan.sendToken ? 'sent' : 'none'}, eth: ${
							plan.sendEth ? `${Number(plan.ethAmountWei) / 1e18}` : 'dust only'
						})`,
				);
			} catch (err) {
				failures += 1;
				console.error(
					`sweep: #${record.index} ${record.address} FAILED — ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}
	if (failures > 0) throw new Error(`${failures} account(s) not swept — see above`);
	console.log(`sweep: ${records.length} account(s) returned to ${cfg.treasuryAddress}`);
}

main().catch((err: unknown) => {
	console.error(`sweep: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
