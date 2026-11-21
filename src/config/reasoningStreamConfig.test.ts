import { describe, expect, it } from 'vitest';

import {
	assertReasoningStreamConfig,
	parseReasoningStreamSetting,
	ReasoningStreamConfigError,
} from './reasoningStreamConfig';

const env = (url?: string, mode?: string) => ({
	VITE_REASONING_STREAM_URL: url,
	VITE_REASONING_STREAM_MODE: mode,
});

describe('the reasoning stream setting', () => {
	it('is off when unset or empty', () => {
		expect(parseReasoningStreamSetting('testnet', env())).toBeNull();
		expect(parseReasoningStreamSetting('testnet', env(''))).toBeNull();
		expect(() => assertReasoningStreamConfig('mainnet', env())).not.toThrow();
	});

	it('takes an https origin, with or without a path, in sse mode by default', () => {
		expect(parseReasoningStreamSetting('testnet', env('https://stream.example'))).toEqual({
			url: 'https://stream.example',
			mode: 'sse',
		});
		expect(
			parseReasoningStreamSetting('mainnet', env('https://stream.example:8443/live', 'poll')),
		).toEqual({ url: 'https://stream.example:8443/live', mode: 'poll' });
	});

	it('takes plain http only for a loopback host on localnet', () => {
		expect(parseReasoningStreamSetting('localnet', env('http://127.0.0.1:8787'))).toEqual({
			url: 'http://127.0.0.1:8787',
			mode: 'sse',
		});
		expect(() =>
			assertReasoningStreamConfig('localnet', env('http://localhost:8787')),
		).not.toThrow();
		expect(() => assertReasoningStreamConfig('testnet', env('http://127.0.0.1:8787'))).toThrow(
			ReasoningStreamConfigError,
		);
		expect(() => assertReasoningStreamConfig('localnet', env('http://stream.example'))).toThrow(
			ReasoningStreamConfigError,
		);
	});

	it.each([
		'https://stream.example/',
		'https://stream.example?x=1',
		'https://stream.example#a',
		'https://user:pw@stream.example',
		'ftp://stream.example',
		'stream.example',
		`0x${'ab'.repeat(32)}`,
	])('stops a build whose URL is %s', value => {
		expect(() => assertReasoningStreamConfig('testnet', env(value))).toThrow(
			/VITE_REASONING_STREAM_URL/,
		);
	});

	it('stops a build whose mode is not sse or poll', () => {
		expect(() =>
			assertReasoningStreamConfig('testnet', env('https://stream.example', 'websocket')),
		).toThrow(/VITE_REASONING_STREAM_MODE/);
	});

	it('describes a refused value by its shape and never prints it', () => {
		const secret = `0x${'ab'.repeat(32)}`;

		expect(() => assertReasoningStreamConfig('testnet', env(secret))).toThrow(/66 characters/);
		try {
			assertReasoningStreamConfig('testnet', env(secret, 'secret-mode-value'));
		} catch (error) {
			expect((error as Error).message).not.toContain(secret);
			expect((error as Error).message).not.toContain('ab'.repeat(8));
		}
		try {
			assertReasoningStreamConfig('testnet', env('https://stream.example', 'secret-mode-value'));
		} catch (error) {
			expect((error as Error).message).not.toContain('secret-mode-value');
		}
	});
});
