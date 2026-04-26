import { describe, it, expect } from 'vitest'
import { deriveKeyFromEntropy, encryptData, decryptData } from '../crypto'

const ENTROPY = 'test-entropy-signature-0xdeadbeef'
const OWNER = '0xabc123def456abc123def456abc123def456abc1'

describe('deriveKeyFromEntropy', () => {
	it('returns a CryptoKey', async () => {
		const key = await deriveKeyFromEntropy(ENTROPY, OWNER)
		expect(key).toBeInstanceOf(CryptoKey)
		expect(key.type).toBe('secret')
		expect(key.algorithm.name).toBe('AES-GCM')
	})

	it('is deterministic — same inputs produce equivalent keys', async () => {
		const key1 = await deriveKeyFromEntropy(ENTROPY, OWNER)
		const key2 = await deriveKeyFromEntropy(ENTROPY, OWNER)

		const raw1 = await window.crypto.subtle.exportKey('raw', key1)
		const raw2 = await window.crypto.subtle.exportKey('raw', key2)

		expect(new Uint8Array(raw1)).toEqual(new Uint8Array(raw2))
	})

	it('produces different keys for different owner addresses', async () => {
		const key1 = await deriveKeyFromEntropy(ENTROPY, OWNER)
		const key2 = await deriveKeyFromEntropy(ENTROPY, '0x9999999999999999999999999999999999999999')

		const raw1 = await window.crypto.subtle.exportKey('raw', key1)
		const raw2 = await window.crypto.subtle.exportKey('raw', key2)

		expect(new Uint8Array(raw1)).not.toEqual(new Uint8Array(raw2))
	})

	it('throws when entropy is empty', async () => {
		await expect(deriveKeyFromEntropy('', OWNER)).rejects.toThrow('Entropy string cannot be empty.')
	})

	it('throws when owner address is empty', async () => {
		await expect(deriveKeyFromEntropy(ENTROPY, '')).rejects.toThrow(
			'Owner address must be provided to generate a key salt.',
		)
	})
})

describe('encryptData / decryptData round-trip', () => {
	it('encrypts and decrypts an object correctly', async () => {
		const key = await deriveKeyFromEntropy(ENTROPY, OWNER)
		const original = { hello: 'world', num: 42, nested: { a: [1, 2, 3] } }

		const encrypted = await encryptData(key, original)
		expect(typeof encrypted).toBe('string')
		expect(encrypted).toMatch(/^.+\..+$/) // "iv.cipher" format

		const decrypted = await decryptData(key, encrypted)
		expect(decrypted).toEqual(original)
	})

	it('decryptData throws on invalid format', async () => {
		const key = await deriveKeyFromEntropy(ENTROPY, OWNER)
		await expect(decryptData(key, 'nodothere')).rejects.toThrow(
			'Invalid encrypted data format. Expected "iv.encryptedData".',
		)
	})
})
