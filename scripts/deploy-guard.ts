/**
 * `bun scripts/deploy-guard.ts` — the confirm step in front of `deploy:mainnet`.
 *
 * Exits 0 only when DEPLOY_MAINNET_CONFIRMED=1 is exported in the environment (one confirmation
 * line on stdout); anything else (unset, empty, "true", "yes") exits 1 with the refusal and the
 * exact command to run on stderr. Mirrors
 * REHEARSAL_MAINNET_CONFIRMED in tokenized-ai-agent: the production hosting site
 * (tradable-app → senseai.tradable.app) is only ever reached on purpose.
 *
 * Why a script and not an inline `test "$VAR" = 1`: the message has to name the target and the
 * fix, and the guard is exercised by e2e/__guards__/deploy-targets.test.ts as a subprocess.
 */
export {};

const CONFIRM_VAR = 'DEPLOY_MAINNET_CONFIRMED';
const TARGET = 'tradable-app (Firebase alias `prod`, site sense-ai-app, senseai.tradable.app)';

const value = process.env[CONFIRM_VAR];

if (value !== '1') {
	console.error(
		[
			`deploy:mainnet refused: this deploys the MAINNET bundle to ${TARGET}.`,
			`${CONFIRM_VAR} is ${
				value === undefined ? 'unset' : JSON.stringify(value)
			}; it must be exactly "1".`,
			'Testnet and localnet bundles go to `bun run deploy:testnet` (tradable-app-garrick) instead.',
			`To confirm: ${CONFIRM_VAR}=1 bun run deploy:mainnet`,
		].join('\n'),
	);
	process.exit(1);
}

console.log(`${CONFIRM_VAR}=1 — proceeding with the mainnet build and deploy to ${TARGET}.`);
