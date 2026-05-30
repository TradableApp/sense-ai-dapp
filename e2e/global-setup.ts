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

import { isGraphRunning } from './helpers/graph';
import { isHardhatRunning } from './helpers/hardhat';

const SUBGRAPH_URL =
	process.env.VITE_THE_GRAPH_API_URL || 'http://localhost:8000/subgraphs/name/sense-ai';
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Checks if the subgraph endpoint is reachable by making a simple GraphQL query.
 */
async function isSubgraphReachable(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

		const response = await fetch(SUBGRAPH_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: '{ _meta { block { number } } }',
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) return false;

		const data = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
		return !data.errors || data.errors.length === 0;
	} catch {
		return false;
	}
}

/**
 * Global setup function that runs once before all tests.
 * Only executes when E2E_LOCAL_SERVICES=1.
 */
export async function globalSetup(): Promise<void> {
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
			startCommand: `GraphQL endpoint at ${SUBGRAPH_URL}`,
			docs: 'See sense-ai-e2e repo: start-e2e.sh',
		},
	];

	const results = await Promise.all(checks.map(async c => ({ ...c, healthy: await c.check() })));

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
