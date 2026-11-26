// @vitest-environment node
//
// Static guard over src/ and the e2e suite (pure Node; see the adr-0002 guard for why the
// environment is pinned per file).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SIGNING_RULES } from './session-signing-rules';
import { E2E_DIR, offenders, sourceFiles, stripComments } from './source-scan';

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
 *
 * Only the session provider asks a wallet to sign anything, and only with this text, and only
 * `deriveSessionKey` makes a key of the signature (it refuses a signature that is not the
 * connected account's plain one). A second way to the same signature (another importer of
 * the builder, `eth_sign` over the message's hash, a wallet request whose method is computed)
 * would let code outside the provider obtain the key's secret.
 */

const ROOT = path.resolve(E2E_DIR, '..');
const SRC = path.join(ROOT, 'src');
const MODULE = path.join('features', 'auth', 'sessionMessage.ts');
const PROVIDER = path.join('features', 'auth', 'SessionProvider.tsx');
const KEY_MODULE = path.join('features', 'auth', 'sessionKey.ts');
const THIS_GUARD = path.join('__guards__', 'session-message-single-source.test.ts');

const isSource = (file: string) =>
	/\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\.(ts|tsx|js|jsx)$/.test(file);
const isE2eCode = (file: string) => /\.(ts|tsx|js|mjs)$/.test(file) && file !== THIS_GUARD;
const read = (...parts: string[]) => stripComments(readFileSync(path.join(...parts), 'utf8'));
const flat = (code: string) => code.replace(/\s+/g, '');

// Words only the message carries (its statement and nonce, and EIP-4361's opening line,
// which viem writes). Matched in any file but the module.
const WORDING =
	/Never sign this message|creates the key that encrypts|SenseAIHistoryKey|wants you to sign in with your Ethereum account/;

/** `src/<file>` for every non-test source file whose flattened code matches `rule`. */
const flatOffenders = (rule: RegExp, allowed: string[] = []) =>
	sourceFiles(SRC, file => isSource(file) && !allowed.includes(file))
		.filter(file => rule.test(flat(read(SRC, file))))
		.map(file => `src/${file}`);

describe('the session message', () => {
	it('is worded only in its module', () => {
		const inSrc = offenders(SRC, file => isSource(file) && file !== MODULE, WORDING);
		const inE2e = offenders(E2E_DIR, isE2eCode, WORDING);

		expect([...inSrc, ...inE2e]).toEqual([]);
	});

	it('is signed only by the session provider', () => {
		expect(flatOffenders(SIGNING_RULES.signer, [PROVIDER])).toEqual([]);
	});

	it('is built only by the session provider', () => {
		expect(flatOffenders(SIGNING_RULES.builderNamed, [MODULE, PROVIDER])).toEqual([]);
		expect(flatOffenders(SIGNING_RULES.moduleImportedWhole)).toEqual([]);
	});

	it('is never hashed for a wallet to sign the hash', () => {
		expect(flatOffenders(SIGNING_RULES.hashMessage)).toEqual([]);
	});

	it('is not reachable through a wallet request whose method is computed', () => {
		expect(flatOffenders(SIGNING_RULES.computedRequestMethod)).toEqual([]);
		expect(flatOffenders(SIGNING_RULES.concatenatedRpcName)).toEqual([]);
	});

	it('becomes a key only through deriveSessionKey', () => {
		expect(flatOffenders(/\bderiveKeyFromEntropy\(/, [KEY_MODULE])).toEqual([]);
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

	it('is asked for only after the page is checked against the site it names', () => {
		const code = flat(read(SRC, PROVIDER));
		const check = code.indexOf(
			"if(!isSessionOriginAllowed(import.meta.env.MODE,window.location.origin)){setStatus('wrong-site');return;}",
		);

		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(code.indexOf('awaitsignMessage('));
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

// Each rule catches what it is for and leaves ordinary code alone, so a rule that matched
// nothing could not pass the scans above unnoticed.
describe('the signing rules', () => {
	const catches = (rule: RegExp, code: string) => rule.test(flat(code));

	it.each([
		['signer', 'await signMessage({ account, message })'],
		['signer', "provider.request({ method: 'personal_sign', params })"],
		['signer', "provider.request({ method: 'eth_sign', params: [address, hash] })"],
		[
			'builderNamed',
			"import { buildSessionMessage as text } from '@/features/auth/sessionMessage';",
		],
		['moduleImportedWhole', "import * as session from '@/features/auth/sessionMessage';"],
		['moduleImportedWhole', "const m = await import('@/features/auth/sessionMessage');"],
		['hashMessage', 'const hash = hashMessage(text);'],
		['computedRequestMethod', 'provider.request({ method: name, params })'],
		['computedRequestMethod', 'provider.request({ params, method })'],
		// A template's text as a fixture, not a template.
		// eslint-disable-next-line no-template-curly-in-string
		['computedRequestMethod', 'provider.request({ method: `personal_${kind}`, params })'],
		['concatenatedRpcName', "const name = 'personal_' + 'sign';"],
		// A template's text as a fixture, not a template.
		// eslint-disable-next-line no-template-curly-in-string
		['concatenatedRpcName', 'const name = `eth_${kind}`;'],
	] as const)('%s catches %s', (rule, code) => {
		expect(catches(SIGNING_RULES[rule], code)).toBe(true);
	});

	it.each([
		['signer', "provider.request({ method: 'eth_signTypedData_v4', params })"],
		['computedRequestMethod', "provider.request({ method: 'eth_chainId' })"],
		['computedRequestMethod', "provider.request({ method: 'eth_call', params: [call] })"],
		['computedRequestMethod', "prepareContractCall({ contract, method: 'cancelPrompt', params })"],
		['concatenatedRpcName', "const label = 'eth_call';"],
		['moduleImportedWhole', "import { sessionSiteFor } from '@/features/auth/sessionMessage';"],
	] as const)('%s leaves %s alone', (rule, code) => {
		expect(catches(SIGNING_RULES[rule], code)).toBe(false);
	});
});
