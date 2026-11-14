// @vitest-environment node
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { abiFingerprint } from '#scripts/abi-fingerprint.mjs';


const abiDir = path.resolve(import.meta.dirname);

function loadAbi(filename: string) {
	return JSON.parse(readFileSync(path.join(abiDir, filename), 'utf8'));
}

/* abiFingerprint is imported from the same module sync-contracts.sh calls, rather than
   reimplemented here. The manifest's correctness used to rest on two copies of this hash
   agreeing — a near-identical helper in each. Sharing it means the test can still catch what
   matters (an ABI that did not come through the sync) while no longer being able to disagree
   with the writer about how the hash is computed. */

describe('EVMAIAgent ABI — PromptSubmitted event', () => {
	const raw = loadAbi('EVMAIAgent.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	const event = abi.find(
		(x: unknown) => (x as any).type === 'event' && (x as any).name === 'PromptSubmitted',
	);

	it('event exists', () => {
		expect(event).toBeDefined();
	});

	it('has 6 inputs', () => {
		expect(event.inputs).toHaveLength(6);
	});

	it('user is indexed', () => {
		expect(event.inputs[0]).toMatchObject({ name: 'user', indexed: true });
	});

	it('conversationId is indexed', () => {
		expect(event.inputs[1]).toMatchObject({ name: 'conversationId', indexed: true });
	});

	it('promptMessageId is indexed', () => {
		expect(event.inputs[2]).toMatchObject({ name: 'promptMessageId', indexed: true });
	});

	it('answerMessageId is NOT indexed', () => {
		expect(event.inputs[3]).toMatchObject({ name: 'answerMessageId', indexed: false });
	});

	it('encryptedPayload is not indexed', () => {
		expect(event.inputs[4]).toMatchObject({ name: 'encryptedPayload', indexed: false });
	});

	it('roflEncryptedKey is not indexed', () => {
		expect(event.inputs[5]).toMatchObject({ name: 'roflEncryptedKey', indexed: false });
	});
});

describe('AbleToken ABI — custom errors used by buildErrorHandler', () => {
	const raw = loadAbi('AbleToken.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	it('ERC20InsufficientBalance error exists', () => {
		const entry = abi.find(
			(x: unknown) => (x as any).type === 'error' && (x as any).name === 'ERC20InsufficientBalance',
		);
		expect(entry).toBeDefined();
	});

	it('ERC20InsufficientAllowance error exists', () => {
		const entry = abi.find(
			(x: unknown) =>
				(x as any).type === 'error' && (x as any).name === 'ERC20InsufficientAllowance',
		);
		expect(entry).toBeDefined();
	});
});

describe('EVMAIAgentEscrow ABI — cancelPrompt and processRefund', () => {
	const raw = loadAbi('EVMAIAgentEscrow.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	it('cancelPrompt accepts _answerMessageId uint256', () => {
		const fn = abi.find(
			(x: unknown) => (x as any).type === 'function' && (x as any).name === 'cancelPrompt',
		);
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(1);
		expect(fn.inputs[0]).toMatchObject({ name: '_answerMessageId', type: 'uint256' });
	});

	it('processRefund accepts _answerMessageId uint256', () => {
		const fn = abi.find(
			(x: unknown) => (x as any).type === 'function' && (x as any).name === 'processRefund',
		);
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(1);
		expect(fn.inputs[0]).toMatchObject({ name: '_answerMessageId', type: 'uint256' });
	});
});

/**
 * THE ENTRIES THAT WENT MISSING FOR TWELVE DAYS.
 *
 * able-contracts#24 and tokenized-ai-agent#86 both merged 2026-09-24. Their regenerated ABIs were
 * never committed here, so `main` shipped a token ABI with no two-step ownership transfer and an
 * escrow ABI that could not decode a SafeERC20 failure — while this file stayed green throughout.
 *
 * It stayed green because every assertion above enumerates entries we already knew about, and an
 * enumeration cannot notice something that was never added to it. These cases pin the specific
 * regression; `SOURCE.json` is what makes the general case inspectable.
 */
describe('AbleToken ABI — Ownable2Step surface (able-contracts#24)', () => {
	const raw = loadAbi('AbleToken.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];
	const find = (type: string, name: string) =>
		abi.find((x: unknown) => (x as any).type === type && (x as any).name === name);

	// Without these two the dApp cannot complete an ownership transfer at all — the functions are
	// on-chain but absent from the ABI, so viem has nothing to encode.
	it('acceptOwnership exists', () => {
		expect(find('function', 'acceptOwnership')).toBeDefined();
	});

	it('pendingOwner exists', () => {
		expect(find('function', 'pendingOwner')).toBeDefined();
	});

	it('OwnershipTransferStarted event exists', () => {
		expect(find('event', 'OwnershipTransferStarted')).toBeDefined();
	});

	// Decodability, not callability: renounceOwnership now reverts with this, and without the entry
	// the user sees an undecodable blob instead of a reason.
	it('OwnershipCannotBeRenounced error exists', () => {
		expect(find('error', 'OwnershipCannotBeRenounced')).toBeDefined();
	});

	it('has a constructor entry (implementation locked via _disableInitializers)', () => {
		expect(abi.some((x: unknown) => (x as any).type === 'constructor')).toBe(true);
	});
});

describe('EVMAIAgentEscrow ABI — SafeERC20 surface (tokenized-ai-agent#86)', () => {
	const raw = loadAbi('EVMAIAgentEscrow.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];

	it('SafeERC20FailedOperation error exists', () => {
		const entry = abi.find(
			(x: unknown) => (x as any).type === 'error' && (x as any).name === 'SafeERC20FailedOperation',
		);
		expect(entry).toBeDefined();
	});
});

/**
 * THE PRE-MAINNET CONTRACT SERIES.
 *
 * The agent and escrow changed shape over a run of contract PRs: a timeout refund is recorded on
 * the agent, the single oracle address became a role several addresses can hold, the oracle's
 * encryption key moved on chain, every oracle-work request is counted, and a failed refund record
 * can be retried. These cases pin the entries this app reads or will read, and the three that
 * must be gone — an ABI that still offers `oracle()` encodes a call the contract no longer has.
 */
describe('EVMAIAgent ABI — oracle role, on-chain encryption key, refund record, request counter', () => {
	const raw = loadAbi('EVMAIAgent.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];
	const find = (type: string, name: string) =>
		abi.find((x: unknown) => (x as any).type === type && (x as any).name === name);

	it('oracleEncryptionKey returns bytes', () => {
		const fn = find('function', 'oracleEncryptionKey');
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(0);
		expect(fn.outputs).toMatchObject([{ type: 'bytes' }]);
	});

	it('OracleEncryptionKeyUpdated carries the publishing oracle, indexed, and the new key', () => {
		const event = find('event', 'OracleEncryptionKeyUpdated');
		expect(event).toBeDefined();
		expect(event.inputs).toMatchObject([
			{ name: 'publisher', type: 'address', indexed: true },
			{ name: 'newKey', type: 'bytes', indexed: false },
		]);
	});

	it('oracleEncryptionKeyPublisher returns the address that published the key', () => {
		const fn = find('function', 'oracleEncryptionKeyPublisher');
		expect(fn).toBeDefined();
		expect(fn.inputs).toHaveLength(0);
		expect(fn.outputs).toMatchObject([{ type: 'address' }]);
	});

	it('setOracleEncryptionKey takes the key and a proof made by it', () => {
		const fn = find('function', 'setOracleEncryptionKey');
		expect(fn).toBeDefined();
		expect(fn.inputs).toMatchObject([
			{ name: '_newKey', type: 'bytes' },
			{ name: '_proof', type: 'bytes' },
		]);
	});

	it('declares the errors a refused key publication reverts with', () => {
		expect(find('error', 'InvalidEncryptionKeyProof')).toBeDefined();
		expect(find('error', 'EncryptionKeyHeldByAnotherOracle')).toBeDefined();
	});

	it('isOracle takes an address and returns bool', () => {
		const fn = find('function', 'isOracle');
		expect(fn).toBeDefined();
		expect(fn.inputs).toMatchObject([{ type: 'address' }]);
		expect(fn.outputs).toMatchObject([{ type: 'bool' }]);
	});

	it.each(['addOracle', 'removeOracle'])('%s takes one address', name => {
		const fn = find('function', name);
		expect(fn).toBeDefined();
		expect(fn.inputs).toMatchObject([{ type: 'address' }]);
	});

	it.each([
		['function', 'oracle'],
		['function', 'setOracle'],
		['event', 'OracleUpdated'],
	])('the single-oracle %s %s is gone', (type, name) => {
		expect(find(type, name)).toBeUndefined();
	});

	it('PromptRefunded indexes user and answerMessageId', () => {
		const event = find('event', 'PromptRefunded');
		expect(event).toBeDefined();
		expect(event.inputs).toMatchObject([
			{ name: 'user', type: 'address', indexed: true },
			{ name: 'answerMessageId', type: 'uint256', indexed: true },
		]);
	});

	it('requestCount returns uint256 and requestBlock maps a request number to a block', () => {
		const count = find('function', 'requestCount');
		expect(count).toBeDefined();
		expect(count.outputs).toMatchObject([{ type: 'uint256' }]);
		const block = find('function', 'requestBlock');
		expect(block).toBeDefined();
		expect(block.inputs).toMatchObject([{ type: 'uint256' }]);
		expect(block.outputs).toMatchObject([{ type: 'uint256' }]);
	});
});

describe('EVMAIAgentEscrow ABI — refund-record retry and direct-payment event', () => {
	const raw = loadAbi('EVMAIAgentEscrow.json');
	const abi = Array.isArray(raw) ? raw : raw.abi ?? [];
	const find = (type: string, name: string) =>
		abi.find((x: unknown) => (x as any).type === type && (x as any).name === name);

	it('retryRefundRecord accepts _answerMessageId uint256', () => {
		const fn = find('function', 'retryRefundRecord');
		expect(fn).toBeDefined();
		expect(fn.inputs).toMatchObject([{ name: '_answerMessageId', type: 'uint256' }]);
	});

	it.each(['RefundRecordFailed', 'RefundRecordRetried'])('%s indexes the escrow id', name => {
		const event = find('event', name);
		expect(event).toBeDefined();
		expect(event.inputs).toMatchObject([{ name: 'escrowId', type: 'uint256', indexed: true }]);
	});

	it('DirectPaymentProcessed indexes user and amount', () => {
		const event = find('event', 'DirectPaymentProcessed');
		expect(event).toBeDefined();
		expect(event.inputs).toMatchObject([
			{ name: 'user', type: 'address', indexed: true },
			{ name: 'amount', type: 'uint256', indexed: true },
		]);
	});

	// Decodability: retrying a record for an escrow that was never refunded reverts with this.
	it('EscrowNotRefunded error exists', () => {
		expect(find('error', 'EscrowNotRefunded')).toBeDefined();
	});
});

/**
 * SOURCE.json records which upstream commit each ABI came from — the same pin-the-upstream-commit
 * pattern this org already uses for the Brain (EXPECTED_BRAIN_SHA).
 *
 * It cannot prove an ABI is current: artifacts are gitignored build output in both contract repos,
 * so nothing here can fetch a canonical copy without compiling Hardhat inside a frontend CI. What
 * it does is make the question ANSWERABLE — compare the recorded SHA against the repo's default
 * branch. Before it existed the only way to notice drift was to happen to run a local build.
 */
describe('SOURCE.json — upstream provenance for every committed ABI', () => {
	const manifest = loadAbi('SOURCE.json');
	const abiFiles = ['AbleToken.json', 'EVMAIAgent.json', 'EVMAIAgentEscrow.json'];

	it.each(abiFiles)('%s records a repo and a full commit SHA', file => {
		const entry = manifest.sources?.[file];
		expect(entry, `${file} has no entry in SOURCE.json`).toBeDefined();
		expect(entry.repo).toMatch(/^TradableApp\//);
		expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	// The commit pin alone is attestable only by process: `cp`ing a freshly-compiled ABI over one
	// of these and committing leaves the pin describing the WRONG upstream commit, and every
	// assertion above still passes because the format is untouched. The fingerprint closes that —
	// it is written by the sync script from the file it just copied, so an ABI that arrived by any
	// other route no longer matches what the manifest says it is.
	it.each(abiFiles)('%s matches the interface fingerprint recorded for it', file => {
		const entry = manifest.sources?.[file];
		// Same guard as the sibling case above: without it a missing key throws a bare TypeError
		// from the next line and Vitest never prints the message that would name the file.
		expect(entry, `${file} has no entry in SOURCE.json`).toBeDefined();
		expect(entry.abiSha256, `${file} has no abiSha256 in SOURCE.json`).toMatch(/^[0-9a-f]{64}$/);
		expect(
			abiFingerprint(loadAbi(file)),
			`${file} does not match its recorded fingerprint — re-run \`bun run sync-contracts\``,
		).toBe(entry.abiSha256);
	});

	// Guards the guard: a manifest listing ABIs we no longer ship, or missing ones we do, is a
	// manifest nobody can trust to answer the staleness question.
	//
	// Reads the DIRECTORY rather than comparing against `abiFiles` above. Comparing two constants
	// in the same file only restates them: a fourth ABI committed here without being added to
	// `abiFiles` would satisfy it while going unmentioned by the manifest entirely, which is the
	// precise case the assertion claims to catch.
	it('lists exactly the ABI files that are committed', () => {
		const onDisk = readdirSync(abiDir)
			.filter(f => f.endsWith('.json') && f !== 'SOURCE.json')
			.sort();
		expect(onDisk).toEqual([...abiFiles].sort()); // the constant above has not drifted either
		expect(Object.keys(manifest.sources).sort()).toEqual(onDisk);
	});
});
