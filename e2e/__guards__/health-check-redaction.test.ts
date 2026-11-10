// @vitest-environment node
//
// Run 20261110T030552Z: the testnet health check failed on the gateway and its error message
// carried the runner's keyed Graph URL into dapp-1.log and dapp-2.log, which the runner's hygiene
// scan then flagged. Every URL the health check prints goes through redactUrl, and the probe's
// timeout is the chain budget, not a localhost constant.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, stripComments } from './source-scan';

const SRC = stripComments(readFileSync(join(E2E_DIR, 'global-setup.ts'), 'utf8'));

describe('health check output hygiene', () => {
	it('never interpolates GRAPH_URL into a message without redacting it', () => {
		expect(SRC).not.toMatch(/\$\{GRAPH_URL\}/);
		expect(SRC).toMatch(/redactUrl\(GRAPH_URL\)/);
	});

	it('bounds the health probes by the chain budget, not a fixed localhost constant', () => {
		expect(SRC).not.toMatch(/HEALTH_CHECK_TIMEOUT_MS\s*=\s*5_?000/);
		expect(SRC).toMatch(/BUDGET\.healthCheckMs/);
	});

	it('probes the subgraph through the shared helper so retries and redaction live in one place', () => {
		expect(SRC).toMatch(/probeSubgraph\(/);
	});
});
