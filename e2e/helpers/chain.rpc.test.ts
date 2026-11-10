// @vitest-environment node
//
// The one network-facing property of `rpc()` that can be pinned without a chain: every request
// carries a deadline, so a provider endpoint that neither answers nor refuses fails fast instead
// of holding `waitForReceipt` (and the fund/sweep stages built on it) for the OS TCP timeout.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rpc } from './chain';

describe('rpc', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('attaches an abort signal to every request so a stalled endpoint cannot hang the caller', async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' })),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(rpc('eth_chainId')).resolves.toBe('0x1');

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, Parameters<typeof fetch>[1]];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('retries an idempotent read when the provider times out or errors, then succeeds', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }))
			.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: '0x2a' })));
		vi.stubGlobal('fetch', fetchMock);

		await expect(rpc('eth_blockNumber', [], { sleep: async () => {} })).resolves.toBe('0x2a');
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('never retries a transaction broadcast — a resend could double-spend', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(rpc('eth_sendRawTransaction', ['0x00'], { sleep: async () => {} })).rejects.toThrow(/timed out/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('gives up after three attempts and surfaces the last error', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('Too many requests', { status: 429 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(rpc('eth_getBalance', ['0x0', 'latest'], { sleep: async () => {} })).rejects.toThrow(/429/);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
