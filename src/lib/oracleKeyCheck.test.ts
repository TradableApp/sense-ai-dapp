import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { PAID_ACTIONS } from '@/lib/feeTokenCheck';

import {
	KEY_WRAPPING_ACTIONS,
	noKeyStops,
	normaliseOracleKey,
	ORACLE_KEY_VERDICTS,
	oracleKeyBlockCopy,
	oracleKeyBlocks,
	type OracleKeyCheckState,
	readOracleKeyVerdict,
} from './oracleKeyCheck';

const LOCALNET = 31337;
const TESTNET = 84532;
const MAINNET = 8453;

/** A test key pair's public key from a small private key: public test material only. */
function publicKey(secret: number, compressed = false): string {
	const secretKey = new Uint8Array(32);
	secretKey[31] = secret;
	return bytesToHex(secp256k1.getPublicKey(secretKey, compressed));
}

const KEY = publicKey(7);
const OTHER_KEY = publicKey(9);
const ALL_STATES: OracleKeyCheckState[] = [...ORACLE_KEY_VERDICTS, 'unknown'];

const verdict = (onChain: unknown, buildKey: unknown, chainId = TESTNET) =>
	readOracleKeyVerdict({ read: async () => onChain, buildKey, chainId });

describe('normaliseOracleKey', () => {
	it('gives every form the encryption accepts as one uncompressed lower-case form', () => {
		const forms = [
			`0x${KEY}`,
			KEY,
			`0x${KEY.toUpperCase()}`,
			`0X${KEY}`,
			`0x${KEY.slice(2)}`,
			KEY.slice(2),
			`0x${publicKey(7, true)}`,
			publicKey(7, true).toUpperCase(),
		];

		forms.forEach(form => expect(normaliseOracleKey(form), form).toBe(KEY));
	});

	it.each([
		['nothing', undefined],
		['an empty string', ''],
		['not text', 65],
		['not hex', `0x${'zz'.repeat(65)}`],
		['the wrong length', `0x04${'11'.repeat(40)}`],
		['a point off the curve', `0x04${'00'.repeat(32)}${'01'.repeat(32)}`],
	])('refuses %s', (_, value) => {
		expect(normaliseOracleKey(value)).toBeNull();
	});
});

describe('readOracleKeyVerdict', () => {
	it('matches the same key whatever form the build setting is written in', async () => {
		await expect(verdict(`0x${KEY}`, `0x${KEY}`)).resolves.toBe('match');
		await expect(verdict(`0x${KEY}`, publicKey(7, true))).resolves.toBe('match');
		await expect(verdict(`0x${KEY}`, KEY.slice(2).toUpperCase())).resolves.toBe('match');
	});

	it('is a mismatch for another key', async () => {
		await expect(verdict(`0x${OTHER_KEY}`, `0x${KEY}`)).resolves.toBe('mismatch');
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['not a key', '0x04abcd'],
	])('is a mismatch when the build key is %s', async (_, buildKey) => {
		await expect(verdict(`0x${KEY}`, buildKey)).resolves.toBe('mismatch');
	});

	it('is a mismatch when the published value is not a key', async () => {
		await expect(verdict('0x04abcd', `0x${KEY}`)).resolves.toBe('mismatch');
	});

	it.each([TESTNET, MAINNET])('is no-key on chain %i when nothing is published', async chainId => {
		await expect(verdict('0x', `0x${KEY}`, chainId)).resolves.toBe('no-key');
	});

	it('is no-key-localnet on the local chain, where the oracle does not publish', async () => {
		await expect(verdict('0x', `0x${KEY}`, LOCALNET)).resolves.toBe('no-key-localnet');
	});

	it.each([
		['not text', 42],
		['nothing', undefined],
		['not hex', 'nope'],
	])('throws when the read returns %s: no answer is not a wrong key', async (_, onChain) => {
		await expect(verdict(onChain, `0x${KEY}`)).rejects.toThrow(/Oracle key check/);
	});

	it('passes a failed read on', async () => {
		const failed = new Error('node unreachable');
		await expect(
			readOracleKeyVerdict({
				read: async () => {
					throw failed;
				},
				buildKey: `0x${KEY}`,
				chainId: TESTNET,
			}),
		).rejects.toBe(failed);
	});

	it('never puts a key in its error', async () => {
		const error: unknown = await verdict('nope', `0x${KEY}`).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).not.toContain(KEY.slice(4, 20));
	});
});

describe('noKeyStops', () => {
	it('is false only on the local chain', () => {
		expect(noKeyStops(LOCALNET)).toBe(false);
		expect(noKeyStops(TESTNET)).toBe(true);
		expect(noKeyStops(MAINNET)).toBe(true);
	});
});

describe('oracleKeyBlocks', () => {
	it('stops the actions that wrap the session key under a mismatch or no key', () => {
		(['mismatch', 'no-key'] as const).forEach(state => {
			expect(PAID_ACTIONS.filter(action => oracleKeyBlocks(state, action))).toEqual([
				...KEY_WRAPPING_ACTIONS,
			]);
		});
	});

	it('wraps the key for a prompt, a branch and a rename or delete, never for a plan', () => {
		expect([...KEY_WRAPPING_ACTIONS].sort()).toEqual(['branch', 'metadata', 'prompt']);
	});

	it.each(['match', 'no-key-localnet', 'unknown'] as const)('stops nothing under %s', state => {
		expect(PAID_ACTIONS.filter(action => oracleKeyBlocks(state, action))).toEqual([]);
	});
});

describe('oracleKeyBlockCopy', () => {
	it('has words for exactly the states that stop something', () => {
		ALL_STATES.forEach(state => {
			const stops = PAID_ACTIONS.some(action => oracleKeyBlocks(state, action));
			expect(oracleKeyBlockCopy(state) !== null, state).toBe(stops);
		});
	});

	it.each(['mismatch', 'no-key'] as const)(
		'%s says what is off, that nothing is taken and that money back still works',
		state => {
			const copy = oracleKeyBlockCopy(state);
			expect(copy?.title).toBe('Prompts are switched off');
			expect(copy?.description).toContain(
				'Prompts, branches, renames and deletes are switched off',
			);
			expect(copy?.description).toContain('nothing is taken');
			expect(copy?.description).toContain('Cancelling a prompt and claiming a refund still work.');
			expect(copy?.description).not.toMatch(/0x|[0-9a-f]{16}/i);
		},
	);

	it('beside a fee token notice says money back is not affected, rather than that it works', () => {
		const copy = oracleKeyBlockCopy('mismatch', { otherProblem: true });
		expect(copy?.description).toContain(
			'This does not affect cancelling a prompt or claiming a refund.',
		);
		expect(copy?.description).not.toContain('still work.');
	});
});
