/**
 * Global setup for Playwright E2E tests.
 *
 * With a live stack (E2E_LOCAL_SERVICES=1 on localnet; always on testnet) this verifies the
 * stack is reachable before any test runs, failing fast with a clear, actionable error instead
 * of confusing per-test timeouts. Localnet checks the local Hardhat node, graph-node and the
 * subgraph; testnet checks the chain RPC answers with the expected chain id, The Graph Studio
 * endpoint, and the hosted dApp.
 */

import { CHAIN, getChainConfig, isChainReachable, LIVE_STACK, redactUrl } from './helpers/chain';
import { resetFreshAccountAllocator } from './helpers/fresh-account';
// GRAPH_URL / GRAPH_NODE_ORIGIN are imported (not re-derived) so the health
// check can never pass/fail against a different endpoint than the tests query.
import { GRAPH_NODE_ORIGIN, GRAPH_URL, isGraphRunning } from './helpers/graph';
import { isHardhatRunning } from './helpers/hardhat';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Bounds a health check so a hung connection (e.g. a TCP connect that neither
 * resolves nor refuses) can't stall the whole suite — a probe that doesn't
 * settle within HEALTH_CHECK_TIMEOUT_MS is treated as unhealthy. This keeps the
 * "fail fast" guarantee even when the underlying fetch has no timeout of its own.
 */
async function withTimeout(check: () => Promise<boolean>): Promise<boolean> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<boolean>(resolve => {
		timeoutId = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS);
	});
	try {
		return await Promise.race([check(), timeout]);
	} catch {
		return false;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

/**
 * Checks if the subgraph endpoint is reachable by making a simple GraphQL query.
 */
async function isSubgraphReachable(): Promise<boolean> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
	try {
		const response = await fetch(GRAPH_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: '{ _meta { block { number } } }',
			}),
			signal: controller.signal,
		});

		if (!response.ok) return false;

		const data = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
		return !data.errors || data.errors.length === 0;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function isDappReachable(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(baseUrl, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
		return res.ok;
	} catch {
		return false;
	}
}

interface HealthCheck {
	name: string;
	check: () => Promise<boolean>;
}

function localnetChecks(): HealthCheck[] {
	// Endpoint context lives in `name` because that's what the error prints; the
	// single start-e2e.sh remediation below covers all three, so per-service
	// start commands would be redundant (and easy to let go stale).
	return [
		{ name: 'Hardhat Node (http://127.0.0.1:8545)', check: isHardhatRunning },
		{ name: `Graph Node (${GRAPH_NODE_ORIGIN})`, check: isGraphRunning },
		{ name: `Subgraph Endpoint (${GRAPH_URL})`, check: isSubgraphReachable },
	];
}

function testnetChecks(): HealthCheck[] {
	const cfg = getChainConfig();
	return [
		{
			name: `Chain RPC ${redactUrl(cfg.rpcUrl)} (chain id ${cfg.chainId})`,
			check: isChainReachable,
		},
		{ name: `Subgraph Endpoint (${GRAPH_URL})`, check: isSubgraphReachable },
		{ name: `Hosted dApp (${cfg.baseUrl})`, check: () => isDappReachable(cfg.baseUrl) },
	];
}

const LOCALNET_REMEDY =
	`To fix this, run the local service stack from the sense-ai-e2e repository:\n\n` +
	`  bash start-e2e.sh\n\n` +
	`This starts:\n` +
	`  • Hardhat local node (http://127.0.0.1:8545)\n` +
	`  • The Graph node (${GRAPH_NODE_ORIGIN})\n` +
	`  • Subgraph indexing at ${GRAPH_URL}\n\n` +
	`Then retry your tests:\n\n` +
	`  E2E_LOCAL_SERVICES=1 bun run test:e2e\n`;

const TESTNET_REMEDY =
	`Testnet mode brings nothing up. Run sense-ai-e2e scripts/testnet/verify-stack.sh — it names\n` +
	`the stale layer and its fix — then start the run again through run-e2e-testnet.sh.\n`;

/**
 * Global setup function that runs once before all tests.
 * Health checks only execute with a live stack.
 */
export default async function globalSetup(): Promise<void> {
	// Reset the per-test fresh-account allocator once per run. Module counters
	// don't survive Playwright worker recycling, so the next-account index is
	// file-persisted (helpers/fresh-account.ts) and must start clean each run.
	await resetFreshAccountAllocator();

	if (!LIVE_STACK) return;

	console.log(`\n📋 Checking ${CHAIN} stack dependencies...\n`);

	const checks = CHAIN === 'testnet' ? testnetChecks() : localnetChecks();
	const results = await Promise.all(
		checks.map(async c => ({ ...c, healthy: await withTimeout(c.check) })),
	);

	const unhealthyServices = results.filter(r => !r.healthy);

	if (unhealthyServices.length === 0) {
		console.log(`✓ All ${CHAIN} services are healthy.\n`);
		return;
	}

	// At least one service is down
	const serviceList = unhealthyServices.map(s => `  ✗ ${s.name}`).join('\n');

	throw new Error(
		`\n❌ The following ${CHAIN} services are not reachable:\n\n${serviceList}\n\n${
			CHAIN === 'testnet' ? TESTNET_REMEDY : LOCALNET_REMEDY
		}`,
	);
}
