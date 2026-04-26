// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const abiDir = path.resolve(import.meta.dirname, '../../lib/abi')

function loadAbi(filename) {
	const raw = JSON.parse(readFileSync(path.join(abiDir, filename), 'utf8'))
	return Array.isArray(raw) ? raw : raw.abi
}

describe('PromptSubmitted ABI guard', () => {
	it('EVMAIAgent ABI has PromptSubmitted event with answerMessageId at index 3', () => {
		const abi = loadAbi('EVMAIAgent.json')
		const event = abi.find((e) => e.type === 'event' && e.name === 'PromptSubmitted')

		expect(event).toBeDefined()
		// Non-indexed params only (indexed params are filtered by ethers/viem before returning as args)
		const nonIndexed = event.inputs.filter((i) => !i.indexed)
		expect(nonIndexed[0].name).toBe('answerMessageId')
	})

	it('PromptSubmitted event has exactly 6 inputs in the correct order', () => {
		const abi = loadAbi('EVMAIAgent.json')
		const event = abi.find((e) => e.type === 'event' && e.name === 'PromptSubmitted')

		expect(event.inputs).toHaveLength(6)
		expect(event.inputs[0].name).toBe('user')
		expect(event.inputs[1].name).toBe('conversationId')
		expect(event.inputs[2].name).toBe('promptMessageId')
		expect(event.inputs[3].name).toBe('answerMessageId')
		expect(event.inputs[4].name).toBe('encryptedPayload')
		expect(event.inputs[5].name).toBe('roflEncryptedKey')
	})

	it('answerMessageId is non-indexed uint256', () => {
		const abi = loadAbi('EVMAIAgent.json')
		const event = abi.find((e) => e.type === 'event' && e.name === 'PromptSubmitted')
		const param = event.inputs[3]

		expect(param.name).toBe('answerMessageId')
		expect(param.type).toBe('uint256')
		expect(param.indexed).toBe(false)
	})

	it('EVMAIAgentEscrow ABI contains finalizePayment function', () => {
		const abi = loadAbi('EVMAIAgentEscrow.json')
		const fn = abi.find((e) => e.type === 'function' && e.name === 'finalizePayment')

		expect(fn).toBeDefined()
		expect(fn.inputs[0].name).toBe('answerMessageId')
		expect(fn.inputs[0].type).toBe('uint256')
	})
})
