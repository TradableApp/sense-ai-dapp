import { describe, expect, it } from 'vitest';

import { describeFailure, failureReport } from './feeTokenCheckFailure';

const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('describeFailure', () => {
	it.each([
		[
			'a reading the contract does not declare',
			named('FeeTokenCheckError', 'Fee token check: the symbol is not text.'),
			'invalid-reading',
		],
		[
			'a build with no contracts for the chain',
			new Error('Fee token check: no contracts for this chain.'),
			'no-contracts',
		],
		[
			'an empty answer that cannot be decoded',
			new Error('Cannot decode zero data ("0x") with ABI parameters.'),
			'zero-data',
		],
		[
			'a function that returned no data',
			new Error('The contract function "symbol" returned no data ("0x").'),
			'zero-data',
		],
		[
			'a node that answered with an HTTP error',
			new Error('RPC request failed with status 429 - Too Many Requests: rate limited'),
			'rpc',
		],
		[
			'a batch the node did not answer',
			new Error('RPC Error from https://84532.rpc.example/key:\nrequests: []'),
			'rpc',
		],
		['a JSON-RPC error object', { code: -32000, message: 'header not found' }, 'rpc'],
		['a fetch that never reached the node', new TypeError('Failed to fetch'), 'node'],
		['a fetch that failed on the server side', new Error('fetch failed'), 'node'],
		[
			'a browser network error',
			new Error('NetworkError when attempting to fetch resource.'),
			'node',
		],
		['an aborted request', named('AbortError', 'signal is aborted without reason'), 'node'],
		['a request that timed out', named('TimeoutError', 'The operation timed out.'), 'node'],
		['anything else', new Error('the ABI has no paused()'), 'other'],
		[
			'an Error that happens to carry a numeric code',
			Object.assign(new Error('something broke'), { code: -32000 }),
			'other',
		],
		['a value that is not an error', 'boom', 'other'],
	])('sorts %s', (_label, error, kind) => {
		const failure = describeFailure(error);

		expect(failure.kind).toBe(kind);
	});

	it('keeps only the first line', () => {
		const error = new Error('RPC Error from node:\nrequests: [{"params":[]}]\nresponses: []');

		const { line } = describeFailure(error);

		expect(line).toBe('RPC Error from node:');
	});

	it('replaces a URL, with whatever key it carries', () => {
		const error = new Error('RPC Error from https://84532.rpc.example/abc123?key=s3cret: oops');

		const { line } = describeFailure(error);

		expect(line).toBe('RPC Error from <url> oops');
	});

	it('replaces 0x and nine or more hex digits, which can be a wallet address or call data', () => {
		const error = new Error(`execution reverted for ${ADDRESS} with 0xdeadbeef01`);

		const { line } = describeFailure(error);

		expect(line).toBe('execution reverted for <hex> with <hex>');
	});

	it('leaves shorter hex alone: an empty answer and a status code are not private', () => {
		const error = new Error('returned no data ("0x"), code 0x1234567');

		const { line } = describeFailure(error);

		expect(line).toBe('returned no data ("0x"), code 0x1234567');
	});

	it.each([
		['a websocket URL', 'socket closed: wss://node.example/v2/KEY123', 'socket closed: <url>'],
		['a URL with no scheme', 'refused by node.example.com/v2/KEY123 now', 'refused by <url> now'],
		['upper-case 0X hex', `from 0X${ADDRESS.slice(2)}`, 'from <hex>'],
		['bare long hex', 'request 9f3c2a7b1d4e8f60aa12 failed', 'request <hex> failed'],
		[
			'a host and port',
			'connect refused api.node.example.com:8545 now',
			'connect refused <url> now',
		],
		['a host, port and path', 'refused by node.example.com:8545/v2/KEY123', 'refused by <url>'],
		['localhost and a port', 'connect ECONNREFUSED localhost:8545', 'connect ECONNREFUSED <url>'],
		[
			'a host and port before a comma',
			'from node.example.com:8545, retrying',
			'from <url> retrying',
		],
		[
			'a user and password before a host, with no scheme',
			'refused by alice:s3cret@node.example.com now',
			'refused by <url> now',
		],
		[
			'a key in the user part before a host and port',
			'refused by KEY123@node.example.com:8545',
			'refused by <url>',
		],
		[
			'a host followed only by a query',
			'refused by node.example.com?apikey=s3cret now',
			'refused by <url> now',
		],
		['localhost followed by a path', 'refused by localhost/v2/KEY123', 'refused by <url>'],
		[
			'an IPv6 literal with a port',
			'connect ECONNREFUSED [::1]:8545',
			'connect ECONNREFUSED <url>',
		],
		[
			'an IPv6 literal with a path',
			'refused by [2001:db8::7]/v2/KEY123 now',
			'refused by <url> now',
		],
	])('replaces %s', (_label, message, expected) => {
		const { line } = describeFailure(new Error(message));

		expect(line).toBe(expected);
	});

	it.each([
		'Error: 500',
		'timeout: 30',
		'status:429 after retry 3:2',
		'block 12:45 at height 1.5: 7',
		'did you mean config.json? no',
		'array [1] and [0:2] are fine',
	])('leaves the ordinary colon and number in %j alone', message => {
		const { line } = describeFailure(new Error(message));

		expect(line).toBe(message);
	});

	it('leaves plain words and a short code alone', () => {
		const { line } = describeFailure(new Error('header not found: decade 0xabc'));

		expect(line).toBe('header not found: decade 0xabc');
	});

	it('never throws, even for an error whose message cannot be read', () => {
		const hostile = Object.defineProperty(new Error('x'), 'message', {
			get() {
				throw new Error('getter');
			},
		});

		const failure = describeFailure(hostile);

		expect(failure).toEqual({ kind: 'other', line: '' });
	});

	it('never throws for a proxy that refuses every question', () => {
		const refuse = () => {
			throw new Error('trap');
		};
		const hostile = new Proxy(
			{},
			{ get: refuse, has: refuse, getPrototypeOf: refuse, ownKeys: refuse },
		);

		const failure = describeFailure(hostile);

		expect(failure).toEqual({ kind: 'other', line: '' });
	});

	it('caps the line at 120 characters', () => {
		const error = new Error('x'.repeat(500));

		const { line } = describeFailure(error);

		expect(line).toHaveLength(120);
	});

	it('takes the message of a JSON-RPC error object', () => {
		const { line } = describeFailure({ code: 3, message: 'execution reverted' });

		expect(line).toBe('execution reverted');
	});

	it('has an empty line for nothing at all', () => {
		const failure = describeFailure(undefined);

		expect(failure).toEqual({ kind: 'other', line: '' });
	});
});

describe('failureReport', () => {
	it('is a new error carrying only the kind and the line', () => {
		const report = failureReport({ kind: 'rpc', line: 'RPC Error from <url>' });

		expect(report).toBeInstanceOf(Error);
		expect(report.name).toBe('FeeTokenCheckFailure');
		expect(report.message).toBe('rpc: RPC Error from <url>');
	});

	it('carries the kind alone when there is no line', () => {
		const report = failureReport({ kind: 'other', line: '' });

		expect(report.message).toBe('other');
	});
});
