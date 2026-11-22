// @vitest-environment node
//
// `tryTransfer` asks the token with `eth_call` whether a transfer would go through, and names the
// token error a refusal carries. A local node names the error in its message; a public node gives
// only the revert data, sometimes one level down. Both must come out as the same refusal, or the
// testnet run is the first place the data-only path runs.
import { encodeErrorResult, parseAbi } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tryTransfer } from './transferRule';

const TOKEN = '0x00000000000000000000000000000000000000aa';
const FROM = '0x00000000000000000000000000000000000000b1';
const TO = '0x000000000000000000000000000000000000d00d';

const ERRORS = parseAbi([
	'error TransferNotAllowed(address from, address to)',
	'error SomethingElse(uint256 code)',
]);
const REFUSED = encodeErrorResult({
	abi: ERRORS,
	errorName: 'TransferNotAllowed',
	args: [FROM, TO],
});
const UNKNOWN = encodeErrorResult({ abi: ERRORS, errorName: 'SomethingElse', args: [7n] });

/** The node answers the call with a JSON-RPC error carrying `message` and `data`. */
function nodeRefuses(message: string, data?: unknown) {
	const fetchMock = vi.fn(
		async () =>
			new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 3, message, data } })),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const lower = (args: readonly unknown[]) => args.map(a => String(a).toLowerCase());

describe('tryTransfer', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is not refused when the call returns', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }))),
		);

		await expect(tryTransfer(TOKEN, FROM, TO, 1n)).resolves.toEqual({ refused: false });
	});

	it('asks with eth_call from the holder, so nothing is sent', async () => {
		const fetchMock = nodeRefuses('execution reverted', REFUSED);

		await tryTransfer(TOKEN, FROM, TO, 1n);

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, Parameters<typeof fetch>[1]];
		const body = JSON.parse(String(init?.body));
		expect(body.method).toBe('eth_call');
		expect(body.params[0]).toMatchObject({ from: FROM, to: TOKEN });
	});

	it('decodes the error and its addresses from revert data alone (a public node)', async () => {
		nodeRefuses('execution reverted', REFUSED);

		const outcome = await tryTransfer(TOKEN, FROM, TO, 1n);

		expect(outcome).toMatchObject({ refused: true, error: 'TransferNotAllowed' });
		if (!outcome.refused) throw new Error('expected a refusal');
		expect(lower(outcome.args)).toEqual([FROM, TO]);
	});

	it('decodes revert data that the node put one level down', async () => {
		nodeRefuses('execution reverted', { message: 'reverted', data: REFUSED });

		const outcome = await tryTransfer(TOKEN, FROM, TO, 1n);

		expect(outcome).toMatchObject({ refused: true, error: 'TransferNotAllowed' });
		if (!outcome.refused) throw new Error('expected a refusal');
		expect(lower(outcome.args)).toEqual([FROM, TO]);
	});

	it('takes the name from the message when there is no data (a local node), with no addresses', async () => {
		nodeRefuses(
			"VM Exception while processing transaction: reverted with custom error 'TransferNotAllowed(...)'",
		);

		const outcome = await tryTransfer(TOKEN, FROM, TO, 1n);

		expect(outcome).toMatchObject({ refused: true, error: 'TransferNotAllowed', args: [] });
	});

	it('falls back to the message when the data is an error this file does not know', async () => {
		nodeRefuses('execution reverted', UNKNOWN);

		await expect(tryTransfer(TOKEN, FROM, TO, 1n)).resolves.toMatchObject({
			refused: true,
			error: undefined,
			args: [],
		});
	});

	it('falls back to the message when the data is too short to hold a selector', async () => {
		nodeRefuses('execution reverted: EnforcedPause()', '0x');

		await expect(tryTransfer(TOKEN, FROM, TO, 1n)).resolves.toMatchObject({
			refused: true,
			error: 'EnforcedPause',
			args: [],
		});
	});

	it('keeps the node message beside the decoded error, for the failure report', async () => {
		nodeRefuses('execution reverted', REFUSED);

		const outcome = await tryTransfer(TOKEN, FROM, TO, 1n);

		expect(outcome).toMatchObject({ message: expect.stringContaining('execution reverted') });
	});

	it('rethrows a failure that is not the node refusing the call', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Bad request', { status: 400 })),
		);

		await expect(tryTransfer(TOKEN, FROM, TO, 1n)).rejects.toThrow(/RPC HTTP 400/);
	});
});
