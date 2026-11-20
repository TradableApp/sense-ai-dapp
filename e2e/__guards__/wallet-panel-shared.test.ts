// @vitest-environment node
//
// Static guard over src/ (pure Node; see the adr-0002 guard for why the environment is
// pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, sourceFiles, stripComments } from './source-scan';

/**
 * Every connected-wallet button takes its panel settings from `src/config/walletPanel.ts`.
 *
 * The button is rendered in several places. The panel's send and buy buttons, and the
 * balance it shows, follow the fee token; a copy of the button with its own inline
 * settings would offer to send a token that cannot be sent, on that one screen only.
 */

const SRC = path.resolve(E2E_DIR, '..', 'src');
const isComponent = (file: string) => /\.(tsx|jsx)$/.test(file) && !/\.test\./.test(file);

const sites = sourceFiles(SRC, isComponent)
	.map(file => ({ file, source: stripComments(readFileSync(path.join(SRC, file), 'utf8')) }))
	.filter(({ source }) => /<ConnectButton\b/.test(source));

describe('connected-wallet buttons share one panel configuration', () => {
	it('finds the buttons it is meant to check', () => {
		expect(sites.length).toBeGreaterThanOrEqual(4);
	});

	it.each(sites)('$file uses the shared panel settings and balance token', ({ source }) => {
		const buttons = source.match(/<ConnectButton\b/g) ?? [];

		expect(source.match(/detailsModal=\{WALLET_DETAILS_MODAL\}/g) ?? []).toHaveLength(
			buttons.length,
		);
		expect(source.match(/displayBalanceToken: DISPLAY_BALANCE_TOKEN\b/g) ?? []).toHaveLength(
			buttons.length,
		);
		expect(source).not.toMatch(/detailsModal=\{\{/);
	});
});
