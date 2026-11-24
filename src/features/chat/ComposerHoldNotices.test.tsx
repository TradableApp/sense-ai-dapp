import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ComposerHoldNotices from './ComposerHoldNotices';

afterEach(cleanup);

const branchNotice = () => screen.getByTestId('branch-history-hold').textContent ?? '';

describe('the notice of a branch held for its history', () => {
	it('says the earlier messages have not loaded yet', () => {
		render(
			<ComposerHoldNotices
				isHeldForBranchHistory
				unsavedSendReason={null}
				isHistoryRefreshFailing={false}
			/>,
		);
		expect(branchNotice()).toMatch(/not loaded on this device yet/i);
		expect(branchNotice()).not.toMatch(/could not be refreshed/i);
	});

	// The wait is for a sync, and the sync is failing: a notice that only said "we keep trying"
	// would leave the user waiting without knowing why.
	it('says the history could not be refreshed just now while The Graph cannot be read', () => {
		render(
			<ComposerHoldNotices
				isHeldForBranchHistory
				unsavedSendReason={null}
				isHistoryRefreshFailing
			/>,
		);
		expect(branchNotice()).toMatch(/not loaded on this device yet/i);
		expect(branchNotice()).toMatch(/could not be refreshed just now/i);
	});

	it('says nothing of the refresh while the branch is not held', () => {
		render(
			<ComposerHoldNotices
				isHeldForBranchHistory={false}
				unsavedSendReason={null}
				isHistoryRefreshFailing
			/>,
		);
		expect(branchNotice()).toBe('');
	});
});
