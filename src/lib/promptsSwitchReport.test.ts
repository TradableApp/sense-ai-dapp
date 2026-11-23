import * as Sentry from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetSwitchReports, reportListenerFailure } from './promptsSwitchReport';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

beforeEach(() => {
	forgetSwitchReports();
	vi.mocked(Sentry.captureException).mockClear();
});

const reportedTags = () =>
	(vi.mocked(Sentry.captureException).mock.calls[0][1] as { tags: Record<string, string> }).tags;

// The code goes into a tag and the message: only something shaped like a Firestore code may.
describe('a listener failure whose code is not a Firestore code', () => {
	it.each([
		['text with spaces', 'Missing or insufficient permissions for /projects/p-123'],
		['upper case', 'PERMISSION_DENIED'],
		['too long', `a${'b'.repeat(40)}`],
		['not a string', 42],
	])('is reported as other: %s', (_name, code) => {
		reportListenerFailure(code);

		expect(reportedTags().failure).toBe('listener-other');
		const [error] = vi.mocked(Sentry.captureException).mock.calls[0];
		expect((error as Error).message).toBe('The prompts switch listener failed: other.');
	});

	it('a Firestore code is reported as itself', () => {
		reportListenerFailure('permission-denied');

		expect(reportedTags().failure).toBe('listener-permission-denied');
	});
});
