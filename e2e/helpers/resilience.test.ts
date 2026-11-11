// @vitest-environment node
//
// Pure logic behind the two run-day resilience specs (testnet-resilience project). No chain, no
// browser: every clock, read and sleep is injected so the wait logic is proven without time.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
	type Abi,
	decodeFunctionData,
	encodeEventTopics,
	keccak256,
	parseAbi,
	toFunctionSelector,
	toHex,
} from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { RESILIENCE_BUDGETS } from './budgets';
import {
	decodeUint256,
	evidenceDirFrom,
	expiryTarget,
	findPaymentRefundedLog,
	isPaymentRefundedLog,
	oracleDownSkipReason,
	paymentRefundedTopics,
	pendingEscrowCountCalldata,
	processRefundCalldata,
	refundReadiness,
	refundTimeoutCalldata,
	setSpendingLimitCalldata,
	waitForChainTime,
	writeResilienceEvidence,
} from './resilience';
import escrowArtifact from '../../src/lib/abi/EVMAIAgentEscrow.json';

const ESCROW_ABI = parseAbi([
	'function setSpendingLimit(uint256 _allowance, uint256 _expiresAt)',
	'function processRefund(uint256 _answerMessageId)',
	'function pendingEscrowCount(address) view returns (uint256)',
	'function REFUND_TIMEOUT() view returns (uint256)',
]);
const USER = '0x1111111111111111111111111111111111111111';
const TX_HASH = `0x${'ab'.repeat(32)}`;

describe('setSpendingLimitCalldata', () => {
	it('encodes setSpendingLimit(uint256,uint256) with the absolute expiry', () => {
		const data = setSpendingLimitCalldata(5n * 10n ** 18n, 1_800_000_000n);
		expect(data.slice(0, 10)).toBe(toFunctionSelector('setSpendingLimit(uint256,uint256)'));
		const { functionName, args } = decodeFunctionData({ abi: ESCROW_ABI, data });
		expect(functionName).toBe('setSpendingLimit');
		expect(args).toEqual([5n * 10n ** 18n, 1_800_000_000n]);
	});

	it('refuses a negative or fractional value before encoding', () => {
		expect(() => setSpendingLimitCalldata(-1n, 10n)).toThrow(/allowance/);
		expect(() => setSpendingLimitCalldata(1n, -10n)).toThrow(/expiresAt/);
	});
});

describe('processRefundCalldata and pendingEscrowCountCalldata', () => {
	it('encodes processRefund(uint256) for the answer message id', () => {
		const data = processRefundCalldata(42n);
		expect(data.slice(0, 10)).toBe(toFunctionSelector('processRefund(uint256)'));
		expect(decodeFunctionData({ abi: ESCROW_ABI, data }).args).toEqual([42n]);
	});

	it('encodes pendingEscrowCount(address) and rejects a non-address', () => {
		const data = pendingEscrowCountCalldata(USER);
		expect(data.slice(0, 10)).toBe(toFunctionSelector('pendingEscrowCount(address)'));
		expect(() => pendingEscrowCountCalldata('0xnope')).toThrow(/address/);
	});

	it('encodes REFUND_TIMEOUT() so the window is read from the contract, not hardcoded', () => {
		expect(refundTimeoutCalldata()).toBe(toFunctionSelector('REFUND_TIMEOUT()'));
	});
});

describe('decodeUint256', () => {
	it('parses a hex word and refuses an empty eth_call result', () => {
		expect(decodeUint256('0x3c')).toBe(60n);
		expect(() => decodeUint256('0x')).toThrow(/empty/);
	});
});

describe('expiryTarget', () => {
	it('is the latest chain timestamp plus the requested time-to-live', () => {
		expect(expiryTarget(1_000n, 120n)).toBe(1_120n);
	});

	it('refuses a non-positive time-to-live', () => {
		expect(() => expiryTarget(1_000n, 0n)).toThrow(/time-to-live/);
	});
});

describe('waitForChainTime', () => {
	it('polls the chain, not the wall clock, until the target is passed', async () => {
		const observed = [100, 110, 130];
		const sleeps: number[] = [];
		let clock = 0;
		const result = await waitForChainTime({
			targetS: 125,
			readChainTimeS: async () => observed.shift() ?? 999,
			sleep: async ms => {
				sleeps.push(ms);
				clock += ms;
			},
			now: () => clock,
			pollMs: 5_000,
			timeoutMs: 600_000,
		});
		expect(result).toBe(130);
		expect(sleeps).toEqual([5_000, 5_000]);
	});

	it('returns at once when the chain is already past the target', async () => {
		const result = await waitForChainTime({
			targetS: 10,
			readChainTimeS: async () => 50,
			sleep: async () => {
				throw new Error('must not sleep');
			},
			now: () => 0,
			pollMs: 5_000,
			timeoutMs: 1_000,
		});
		expect(result).toBe(50);
	});

	it('throws naming the chain time when the deadline passes first', async () => {
		let clock = 0;
		await expect(
			waitForChainTime({
				targetS: 1_000_000,
				readChainTimeS: async () => 100,
				sleep: async ms => {
					clock += ms;
				},
				now: () => clock,
				pollMs: 10_000,
				timeoutMs: 30_000,
			}),
		).rejects.toThrow(/chain time .* target 1000000/);
	});
});

describe('refundReadiness', () => {
	it('never reports zero UI time remaining while the UI gate is still shut', () => {
		// The dApp's gate is strict (>), so at the exact boundary it is shut for one more ms.
		const r = refundReadiness({
			chainTimeS: 1_000 + 3_600,
			createdAtS: 1_000,
			refundTimeoutS: 3_600,
			nowMs: (1_000 + 3_600) * 1000,
			uiTimeoutMs: 3_600_000,
		});
		expect(r.uiReady).toBe(false);
		expect(r.uiRemainingMs).toBe(1);
	});

	const createdAtS = 1_000;
	const refundTimeoutS = 3_600;
	const uiTimeoutMs = 3_600_000;

	it('is not ready before the chain window closes, even if the UI gate is open', () => {
		const r = refundReadiness({
			chainTimeS: createdAtS + refundTimeoutS - 1,
			createdAtS,
			refundTimeoutS,
			nowMs: (createdAtS + refundTimeoutS + 5) * 1000,
			uiTimeoutMs,
		});
		expect(r.chainReady).toBe(false);
		expect(r.uiReady).toBe(true);
		expect(r.ready).toBe(false);
		expect(r.chainRemainingS).toBe(1);
	});

	it('is not ready while only the wall-clock gate is closed', () => {
		const r = refundReadiness({
			chainTimeS: createdAtS + refundTimeoutS + 60,
			createdAtS,
			refundTimeoutS,
			nowMs: (createdAtS + refundTimeoutS - 10) * 1000,
			uiTimeoutMs,
		});
		expect(r.chainReady).toBe(true);
		expect(r.uiReady).toBe(false);
		expect(r.ready).toBe(false);
		expect(r.uiRemainingMs).toBe(10_000);
	});

	it('is ready only when both gates are open, with zero remaining time', () => {
		const r = refundReadiness({
			chainTimeS: createdAtS + refundTimeoutS,
			createdAtS,
			refundTimeoutS,
			nowMs: (createdAtS + refundTimeoutS + 1) * 1000,
			uiTimeoutMs,
		});
		expect(r.ready).toBe(true);
		expect(r.chainRemainingS).toBe(0);
		expect(r.uiRemainingMs).toBe(0);
	});

	it('refuses a UI timeout that disagrees with the contract window', () => {
		expect(() =>
			refundReadiness({
				chainTimeS: 0,
				createdAtS,
				refundTimeoutS,
				nowMs: 0,
				uiTimeoutMs: 60_000,
			}),
		).toThrow(/UI refund window/);
	});
});

describe('oracleDownSkipReason', () => {
	it('returns no reason only when the runner exported E2E_RESILIENCE_ORACLE_DOWN=1', () => {
		expect(oracleDownSkipReason({ E2E_RESILIENCE_ORACLE_DOWN: '1' })).toBeUndefined();
	});

	it('explains the skip for every other value', () => {
		for (const env of [
			{},
			{ E2E_RESILIENCE_ORACLE_DOWN: '0' },
			{ E2E_RESILIENCE_ORACLE_DOWN: 'true' },
		]) {
			expect(oracleDownSkipReason(env)).toMatch(/E2E_RESILIENCE_ORACLE_DOWN=1/);
		}
	});
});

describe('evidence directory and writer', () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it('is disabled when E2E_RESILIENCE_EVIDENCE_DIR is unset or empty', () => {
		expect(evidenceDirFrom({})).toBeUndefined();
		expect(evidenceDirFrom({ E2E_RESILIENCE_EVIDENCE_DIR: '' })).toBeUndefined();
		expect(evidenceDirFrom({ E2E_RESILIENCE_EVIDENCE_DIR: '/x/y' })).toBe('/x/y');
	});

	it('writes the evidence JSON, keeping transaction hashes', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'resilience-evidence-'));
		const file = writeResilienceEvidence({
			dir,
			name: 'expiry',
			evidence: { setLimit: { txHash: TX_HASH, block: 12 }, pendingEscrowCount: '0' },
			secrets: [],
		});
		expect(file).toBe(path.join(dir, 'expiry.json'));
		expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({
			setLimit: { txHash: TX_HASH, block: 12 },
			pendingEscrowCount: '0',
		});
	});

	it('refuses a private-key-shaped field by name, without printing its value', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'resilience-evidence-'));
		expect(() =>
			writeResilienceEvidence({
				dir: dir!,
				name: 'bad',
				evidence: { treasury: { privateKey: TX_HASH } },
				secrets: [],
			}),
		).toThrow(/treasury\.privateKey/);
	});

	it('refuses an unprefixed 32-byte hex value (a seed or a key without 0x)', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'resilience-evidence-'));
		const raw = 'cd'.repeat(32);
		expect(() =>
			writeResilienceEvidence({ dir: dir!, name: 'bad', evidence: { note: raw }, secrets: [] }),
		).toThrow(/note/);
	});

	it('refuses any value that contains a registered secret', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'resilience-evidence-'));
		const secret = 'https://rpc.example.test/v1/SECRETKEY123';
		expect(() =>
			writeResilienceEvidence({
				dir: dir!,
				name: 'bad',
				evidence: { detail: `failed at ${secret}` },
				secrets: [secret],
			}),
		).toThrow(/detail/);
	});

	it('refuses a URL carrying a path, since provider URLs embed their key there', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'resilience-evidence-'));
		expect(() =>
			writeResilienceEvidence({
				dir: dir!,
				name: 'bad',
				// A neutral field name, so the value check is what refuses it (not the key-name guard).
				evidence: { server: 'https://provider.example.test/key/abc' },
				secrets: [],
			}),
		).toThrow(/server/);
	});

	it('writes nothing when the evidence directory is not configured', () => {
		expect(
			writeResilienceEvidence({ dir: undefined, name: 'x', evidence: {}, secrets: [] }),
		).toBeUndefined();
	});
});

describe('PaymentRefunded log matching', () => {
	it('builds the event topics for one escrow id', () => {
		const [topic0, topic1] = paymentRefundedTopics(7n);
		expect(topic0).toBe(keccak256(toHex('PaymentRefunded(uint256)')));
		expect(topic1).toBe(`0x${'0'.repeat(63)}7`);
	});

	it('matches the PaymentRefunded event in the synced escrow ABI, so an ABI change fails here', () => {
		// The hand-written signature is checked against the artifact `sync-contracts` copies in.
		const topics = encodeEventTopics({
			abi: escrowArtifact.abi as Abi,
			eventName: 'PaymentRefunded',
			args: { escrowId: 7n },
		});
		expect(topics).toEqual(paymentRefundedTopics(7n));
	});

	it('matches only the log for that escrow id', () => {
		const log = { topics: paymentRefundedTopics(7n) as string[] };
		expect(isPaymentRefundedLog(log, 7n)).toBe(true);
		expect(isPaymentRefundedLog(log, 8n)).toBe(false);
		expect(isPaymentRefundedLog({ topics: [] }, 7n)).toBe(false);
	});
});

describe('refund proof from a transaction receipt', () => {
	const ESCROW = '0x36ec08471F2B995024967204D7542713CfaF5Fa4';
	const refundLog = (address: string, escrowId: bigint) => ({
		address,
		topics: paymentRefundedTopics(escrowId) as string[],
	});

	it('finds the PaymentRefunded log the escrow emitted for this escrow id', () => {
		const logs = [
			{ address: '0x0000000000000000000000000000000000000001', topics: ['0xaa'] },
			refundLog(ESCROW.toLowerCase(), 7n),
		];
		expect(findPaymentRefundedLog(logs, ESCROW, 7n)).toBe(logs[1]);
	});

	it('ignores a refund for another escrow id', () => {
		expect(findPaymentRefundedLog([refundLog(ESCROW, 8n)], ESCROW, 7n)).toBeUndefined();
	});

	it('ignores the same event emitted by another contract', () => {
		const other = '0x0000000000000000000000000000000000000002';
		expect(findPaymentRefundedLog([refundLog(other, 7n)], ESCROW, 7n)).toBeUndefined();
	});

	it('returns undefined for a receipt with no logs', () => {
		expect(findPaymentRefundedLog([], ESCROW, 7n)).toBeUndefined();
	});

	// Run day 2026-11-11: the first real R-REFUND-01 refunded through the dApp and then failed
	// on `eth_getLogs` — the prompt-to-refund window is ~18,000 Base Sepolia blocks and the
	// provider's free tier caps a log query at 10. The refund is proven from its receipt.
	it('the resilience chain helpers and specs never query logs by block range', () => {
		const files = [
			'e2e/helpers/resilience-chain.ts',
			'e2e/specs/resilience-refund.spec.ts',
			'e2e/specs/resilience-expiry.spec.ts',
		];
		const offenders = files.filter(f =>
			readFileSync(path.resolve(process.cwd(), f), 'utf8').includes('eth_getLogs'),
		);
		expect(offenders).toEqual([]);
	});
});

describe('resilience budgets', () => {
	it('testnet polls a refund gently, every 30 s', () => {
		expect(RESILIENCE_BUDGETS.testnet.refundPollMs).toBe(30_000);
	});

	it('testnet refund test timeout covers the full 1 h window plus the surrounding round-trips', () => {
		expect(RESILIENCE_BUDGETS.testnet.refundTestTimeoutMs).toBeGreaterThanOrEqual(75 * 60_000);
	});

	it('testnet expiry margin is a positive number of seconds past expiresAt', () => {
		expect(RESILIENCE_BUDGETS.testnet.expiryMarginS).toBeGreaterThan(0);
	});
});
