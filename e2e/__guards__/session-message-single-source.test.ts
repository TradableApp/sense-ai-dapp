// @vitest-environment node
//
// Static guard over src/ and the e2e suite (pure Node; see the adr-0002 guard for why the
// environment is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2E_DIR, offenders, stripComments } from './source-scan';

/**
 * The message a wallet signs to create the session key is built in one place:
 * `src/features/auth/sessionMessage.ts`.
 *
 * The signature is the key's only input that is not public, so the text decides which
 * history the key opens. It names the site, the chain and the wallet, and not the agent
 * contract, so replacing the contract pair on a network leaves every key as it was,
 * and the same text must come out on every visit and every device, or the history already
 * stored cannot be read. A copy of the wording anywhere else (a second signer, a fixture
 * in the suite) would drift from it unnoticed. The module reads nothing from the page it
 * is opened on: a page served from another host would otherwise name itself in the text.
 * The site comes from the build's mode, and the chain from the build's settings.
 */

const ROOT = path.resolve(E2E_DIR, '..');
const SRC = path.join(ROOT, 'src');
const MODULE = path.join('features', 'auth', 'sessionMessage.ts');
const PROVIDER = path.join('features', 'auth', 'SessionProvider.tsx');
const THIS_GUARD = path.join('__guards__', 'session-message-single-source.test.ts');

const isSource = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\.(ts|tsx|js|jsx)$/.test(file);
const isE2eCode = (file: string) => /\.(ts|tsx|js|mjs)$/.test(file) && file !== THIS_GUARD;
const read = (...parts: string[]) => stripComments(readFileSync(path.join(...parts), 'utf8'));
const flat = (code: string) => code.replace(/\s+/g, '');

// Lines only the message carries. Matched in any file but the module.
const WORDING = /Message version:|Never sign this message|asks you to sign this message/;

describe('the session message', () => {
	it('is worded only in its module', () => {
		const inSrc = offenders(SRC, file => isSource(file) && file !== MODULE, WORDING);
		const inE2e = offenders(E2E_DIR, isE2eCode, WORDING);

		expect([...inSrc, ...inE2e]).toEqual([]);
	});

	it('is signed only by the session provider', () => {
		const signers = offenders(
			SRC,
			file => isSource(file) && file !== PROVIDER,
			/\bsignMessage\b|personal_sign/,
		);

		expect(signers).toEqual([]);
	});

	it('is the text the session provider asks the wallet to sign', () => {
		const code = flat(read(SRC, PROVIDER));

		expect(code).toMatch(
			/import\{[^}]*\bbuildSessionMessage\b[^}]*\}from'@\/features\/auth\/sessionMessage';/,
		);
		expect((code.match(/signMessage\(/g) ?? []).length).toBe(1);
		expect((code.match(/buildSessionMessage\(/g) ?? []).length).toBe(1);
		expect(code).toContain(
			'constmessage=buildSessionMessage({mode:import.meta.env.MODE,chainId:import.meta.env.VITE_CHAIN_ID,walletAddress:account.address,});',
		);
		expect(code).toContain('constsignature=awaitsignMessage({account,message});');
		expect(code).toContain(
			'awaitderiveSessionKey({message,signature,walletAddress:account.address,});',
		);
		expect(code).not.toContain('VITE_AGENT_CONTRACT_ADDRESS');
		expect(code).not.toContain('deriveKeyFromEntropy');
	});

	it('names no agent contract', () => {
		expect(read(SRC, MODULE)).not.toMatch(/agent/i);
	});

	it('reads nothing from the page it is opened on or from the build settings itself', () => {
		const code = read(SRC, MODULE);

		expect(code).not.toMatch(/\b(window|document|location|globalThis|self|navigator)\b/);
		expect(code).not.toMatch(/import\.meta/);
	});
});
