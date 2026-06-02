/**
 * Global setup for Playwright E2E tests.
 *
 * When E2E_LOCAL_SERVICES=1 is set, this verifies that all local services
 * (Hardhat, Graph node, and the dApp's subgraph endpoint) are reachable.
 * If any are down, it fails fast with a clear, actionable error message.
 *
 * This prevents confusing per-test timeouts when developers forget to run
 * the local service stack (start-e2e.sh).
 */

import { GRAPH_URL, isGraphRunning } from './helpers/graph';
import { isHardhatRunning } from './helpers/hardhat';

// Reuse GRAPH_URL from the graph helpers so the health check can never pass/fail
// against a different endpoint than the tests actually query.
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

/**
 * Global setup function that runs once before all tests.
 * Only executes when E2E_LOCAL_SERVICES=1.
 */
export default async function globalSetup(): Promise<void> {
	// Skip setup if not running local services
	if (process.env.E2E_LOCAL_SERVICES !== '1') {
		return;
	}

	console.log('\n📋 Checking local service dependencies for E2E_LOCAL_SERVICES=1...\n');

	const checks = [
		{
			name: 'Hardhat Node',
			check: isHardhatRunning,
			startCommand: 'npm run dev',
			docs: 'See sense-ai-e2e repo: start-e2e.sh',
		},
		{
			name: 'Graph Node',
			check: isGraphRunning,
			startCommand: 'Graph indexing service (see docker-compose.yml)',
			docs: 'See sense-ai-e2e repo: start-e2e.sh',
		},
		{
			name: 'Subgraph Endpoint',
			check: isSubgraphReachable,
			startCommand: `GraphQL endpoint at ${GRAPH_URL}`,
			docs: 'See sense-ai-e2e repo: start-e2e.sh',
		},
	];

	const results = await Promise.all(
		checks.map(async c => ({ ...c, healthy: await withTimeout(c.check) })),
	);

	const unhealthyServices = results.filter(r => !r.healthy);

	if (unhealthyServices.length === 0) {
		console.log('✓ All local services are healthy.\n');
		return;
	}

	// At least one service is down
	const serviceList = unhealthyServices.map(s => `  ✗ ${s.name}`).join('\n');

	throw new Error(
		`\n❌ E2E_LOCAL_SERVICES=1 is set but the following services are not running:\n\n${serviceList}\n\n` +
			`To fix this, run the local service stack from the sense-ai-e2e repository:\n\n` +
			`  bash start-e2e.sh\n\n` +
			`This starts:\n` +
			`  • Hardhat local node (http://127.0.0.1:8545)\n` +
			`  • The Graph node (http://localhost:8000)\n` +
			`  • Subgraph indexing for sense-ai\n\n` +
			`Then retry your tests:\n\n` +
			`  E2E_LOCAL_SERVICES=1 npm run test:e2e\n`,
	);
}
