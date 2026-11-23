// @vitest-environment node
//
// Static guard over the public documents that describe the prompts switch (pure Node; see
// the adr-0002 guard for why the environment is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR } from './source-scan';

/**
 * The switch closes paid actions for one network and agent: for changing the contract pair,
 * for maintenance and for incidents. The public documents do not tie it to a change of the
 * fee token, and do not describe the operator's procedure around it (the drain), which lives
 * in the private runbook. The ADR says how the document is written as it is: by the owner,
 * through the Firestore API, with their own credentials; it does not claim audit logs that
 * nothing turns on.
 */
const ROOT = path.resolve(E2E_DIR, '..');
const ADR = readFileSync(path.join(ROOT, 'docs', 'decisions', '0008-remote-prompts-switch.md'), 'utf8');
const CLAUDE = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

/** The CLAUDE.md paragraph that describes the switch. */
const switchParagraph = CLAUDE.split(/\n\s*\n/).find(part => part.startsWith('**Prompts switch'));

// A change word within one sentence of "fee token", either way round.
const CHANGE = String.raw`\b(?:chang\w*|swap\w*|replac\w*|mov(?:e|es|ed|ing)\b|migrat\w*)`;
const FEE_TOKEN = String.raw`\bfee[- ]token\b`;
const NEAR = String.raw`[^.;\n]{0,80}`;
const FEE_TOKEN_CHANGE = new RegExp(`${CHANGE}${NEAR}${FEE_TOKEN}|${FEE_TOKEN}${NEAR}${CHANGE}`, 'i');

describe('the public documents that describe the prompts switch', () => {
	it('CLAUDE.md has the switch paragraph', () => {
		expect(switchParagraph).toBeDefined();
	});

	it.each([
		['ADR-0008', ADR],
		['the CLAUDE.md switch paragraph', switchParagraph ?? ''],
	])('%s does not tie the switch to a fee token change', (_name, text) => {
		expect(text).not.toMatch(FEE_TOKEN_CHANGE);
	});

	it.each([
		['ADR-0008', ADR],
		['the CLAUDE.md switch paragraph', switchParagraph ?? ''],
	])('%s does not describe the drain', (_name, text) => {
		expect(text).not.toMatch(/\bdrain/i);
	});

	it.each([
		['ADR-0008', ADR],
		['the CLAUDE.md switch paragraph', switchParagraph ?? ''],
	])('%s names what the switch is for: the contract pair, maintenance, incidents', (_name, text) => {
		expect(text).toMatch(/contract pair/);
		expect(text).toMatch(/maintenance/);
		expect(text).toMatch(/incident/);
	});

	it('the ADR says the owner writes the document through the Firestore API', () => {
		expect(ADR).toMatch(/Firestore (?:REST )?API/);
		expect(ADR).toMatch(/own credentials/);
		expect(ADR).not.toMatch(/Admin SDK or the console/);
	});

	it('the ADR does not claim audit logs are on', () => {
		expect(ADR).not.toMatch(/audit logs? (?:are |is )?on\b/i);
		expect(ADR).not.toMatch(/with audit logs/i);
	});
});
