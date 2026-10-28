/**
 * `bun run --silent e2e:testnet:key -- <index>` — prints ONLY the private key of one seed-derived
 * account, for the runner to capture in-process (it hands it to the oracle smoke through the
 * environment). Nothing else is written to stdout; errors go to stderr.
 */
// A module (not a script) so each file's `main` is its own; testnet-only by construction.
export {};

process.env.E2E_CHAIN ??= 'testnet';

async function main(): Promise<void> {
	const raw = process.argv[2];
	const index = Number(raw);
	if (raw === undefined || !Number.isInteger(index) || index < 0) {
		throw new Error(`usage: e2e:testnet:key -- <index> (got ${raw ?? 'nothing'})`);
	}
	const { loadChainEnv } = await import('../helpers/env');
	loadChainEnv();
	const { deriveAccounts } = await import('./accounts');
	const { testnetConfig } = await import('./treasury');
	const [account] = deriveAccounts(testnetConfig().seed, index, 1);
	process.stdout.write(account.privateKey);
}

main().catch((err: unknown) => {
	console.error(`key: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
