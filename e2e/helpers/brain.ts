/**
 * Brain warm-cache / ledger helpers for Playwright specs.
 *
 * The oracle records every answer it settles into `senseai.daily_activity` via
 * `recordAnswerActivity` → `brain.recordActivity`. That write sits OUTSIDE the
 * `MOCK_AI` short-circuit (which only guards `queryAIModel`), so the ledger is
 * observable on the cheap deterministic shard — no LLM spend. Until the stack
 * grew a `senseai` Postgres it was a silent no-op, which is exactly the hole
 * these helpers exist to close.
 *
 * Connection coordinates come from the dApp's generated `.env.localnet` under
 * the `E2E_BRAIN_PG_*` prefix — deliberately NOT `VITE_`, so Vite never inlines
 * the database password into the browser bundle. `playwright.config.ts` loads
 * that file, so Node-side specs see them and the browser never does.
 *
 * The connection is mTLS, matching Cloud SQL's
 * TRUSTED_CLIENT_CERTIFICATE_REQUIRED posture: the local Postgres demands a
 * client certificate signed by the run's throwaway CA. That is the point —
 * the oracle's mTLS bootstrap has no other test anywhere.
 */
import { readFileSync } from 'fs';

import { Client } from 'pg';

export interface BrainPgConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	clientCertPath: string;
	clientKeyPath: string;
	serverCaPath: string;
}

/**
 * The `E2E_BRAIN_PG_*` config, or null when the stack was brought up without a
 * Brain database. Returning null rather than throwing lets specs `test.skip`
 * with a readable reason instead of erroring at import time — the same shape
 * the contract-address guards already use.
 */
export function readBrainPgConfig(): BrainPgConfig | null {
	const host = process.env.E2E_BRAIN_PG_HOST;
	const port = Number(process.env.E2E_BRAIN_PG_PORT);
	const database = process.env.E2E_BRAIN_PG_DATABASE;
	const user = process.env.E2E_BRAIN_PG_USER;
	const password = process.env.E2E_BRAIN_PG_PASSWORD;
	const clientCertPath = process.env.E2E_BRAIN_PG_CLIENT_CERT_PATH;
	const clientKeyPath = process.env.E2E_BRAIN_PG_CLIENT_KEY_PATH;
	const serverCaPath = process.env.E2E_BRAIN_PG_SERVER_CA_PATH;

	if (
		!host ||
		!Number.isInteger(port) ||
		!database ||
		!user ||
		!password ||
		!clientCertPath ||
		!clientKeyPath ||
		!serverCaPath
	) {
		return null;
	}
	return { host, port, database, user, password, clientCertPath, clientKeyPath, serverCaPath };
}

export const BRAIN_PG_SKIP_REASON =
	'Skipped: no Brain Postgres in this stack (E2E_BRAIN_PG_* unset — run sense-ai-e2e/scripts/start-e2e.sh)';

/**
 * Runs one query against the Brain cache DB over mTLS and closes the connection.
 *
 * A fresh client per call, not a pool: these specs make a handful of queries
 * across a ~79-minute suite, and a pool held open across tests is one more
 * thing to leak into teardown. `rejectUnauthorized: false` mirrors the oracle's
 * own `sslmode=verify-ca` + `uselibpqcompat=true` — the CA chain IS verified
 * (via `ca`), the hostname is not, because the throwaway server certificate is
 * issued for the container, not for `localhost`.
 */
export async function brainQuery<T extends Record<string, unknown>>(
	sql: string,
	params: unknown[] = [],
): Promise<T[]> {
	const cfg = readBrainPgConfig();
	if (!cfg) throw new Error('brainQuery called with no E2E_BRAIN_PG_* config');

	const client = new Client({
		host: cfg.host,
		port: cfg.port,
		database: cfg.database,
		user: cfg.user,
		password: cfg.password,
		ssl: {
			ca: readFileSync(cfg.serverCaPath, 'utf8'),
			cert: readFileSync(cfg.clientCertPath, 'utf8'),
			key: readFileSync(cfg.clientKeyPath, 'utf8'),
			rejectUnauthorized: false,
		},
	});
	await client.connect();
	try {
		const res = await client.query(sql, params);
		return res.rows as T[];
	} finally {
		await client.end();
	}
}

export interface LedgerRow extends Record<string, unknown> {
	platform: string;
	kind: string;
	content_hash: string;
	target_id: string | null;
	metadata: Record<string, unknown> | null;
}

/**
 * Ledger rows the oracle attributed to one wallet.
 *
 * `recordAnswerActivity` passes the user wallet as `targetId`, and every spec
 * here claims a fresh account (ADR-0002), so filtering on it isolates this
 * test's rows from every other test sharing the database. Compared lower-cased
 * because the address reaches the oracle as an event field and its checksum
 * casing is not guaranteed to survive.
 */
export async function getOracleLedgerRows(wallet: string): Promise<LedgerRow[]> {
	return brainQuery<LedgerRow>(
		`SELECT platform, kind, content_hash, target_id, metadata
		   FROM senseai.daily_activity
		  WHERE platform = 'oracle' AND lower(target_id) = lower($1)
		  ORDER BY recorded_at ASC`,
		[wallet],
	);
}

/**
 * Polls until `predicate` holds, mirroring `waitForGraph` — the ledger write
 * happens after the answer transaction settles, so it lags the rendered answer
 * by an unbounded-but-small amount and must be retried rather than sampled once.
 */
export async function waitForLedger(
	wallet: string,
	predicate: (_rows: LedgerRow[]) => boolean,
	{ timeoutMs = 60_000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<LedgerRow[]> {
	const deadline = Date.now() + timeoutMs;
	let last: LedgerRow[] = [];
	let lastError: unknown;
	do {
		try {
			last = await getOracleLedgerRows(wallet);
			if (predicate(last)) return last;
		} catch (err) {
			lastError = err;
		}
		await new Promise(r => setTimeout(r, 1_000));
	} while (Date.now() < deadline);

	// One final read after the deadline. The loop queries, sleeps, THEN tests the deadline,
	// so a row written during that last sleep would never be seen: at t=59.1s the predicate
	// fails, we sleep, the oracle writes at t=59.5s, and at t=60.1s the loop exits and throws
	// with data that is already there. Since the ledger write trails escrow settlement by an
	// unbounded-but-small amount, that is a real race on a HEALTHY stack — it would surface as
	// a flaky test rather than an honest failure.
	try {
		last = await getOracleLedgerRows(wallet);
		if (predicate(last)) return last;
	} catch (err) {
		lastError = err;
	}

	const tail = lastError ? ` (last error: ${String(lastError)})` : '';
	throw new Error(
		`waitForLedger: ${label} not met within ${timeoutMs}ms. Last rows: ${JSON.stringify(last)}${tail}`,
	);
}
