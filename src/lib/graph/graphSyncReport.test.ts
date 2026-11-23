import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GraphFetchFailed from './GraphFetchFailed';
import { forgetGraphSyncReports, reportGraphFetchFailed } from './graphSyncReport';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

afterEach(() => {
	forgetGraphSyncReports();
	vi.clearAllMocks();
});

describe('reportGraphFetchFailed', () => {
	it('reports each list and reason once per page load', () => {
		reportGraphFetchFailed(new GraphFetchFailed('messages', 'no-progress'));
		reportGraphFetchFailed(new GraphFetchFailed('messages', 'no-progress'));
		reportGraphFetchFailed(new GraphFetchFailed('messages', 'malformed'));
		reportGraphFetchFailed(new GraphFetchFailed('prompt-requests', 'malformed'));

		expect(Sentry.captureException).toHaveBeenCalledTimes(3);
	});

	it('carries the list, the reason and the error name, and no error text', () => {
		const cause = new TypeError('fetch https://graph.example/key-123 failed for 0xabc');

		reportGraphFetchFailed(new GraphFetchFailed('conversations', 'request', cause));

		const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect(context).toEqual({
			tags: { check: 'graph-sync', list: 'conversations', reason: 'request' },
			extra: { errorName: 'TypeError' },
			fingerprint: ['graph-sync-failed', 'conversations', 'request'],
		});
		expect(JSON.stringify([String(error), context])).not.toMatch(/key-123|0xabc|graph\.example/);
	});

	it('never throws, even when Sentry does', () => {
		vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
			throw new Error('sentry down');
		});

		expect(() =>
			reportGraphFetchFailed(new GraphFetchFailed('conversations', 'malformed')),
		).not.toThrow();
	});
});
