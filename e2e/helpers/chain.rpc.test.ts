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
});
