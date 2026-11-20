import { describe, expect, it } from 'vitest';

import shouldResetPlanForm from './planFormReset';

// The plan dialog stays mounted while it is closed, so its form keeps whatever was typed.
describe('shouldResetPlanForm', () => {
	it('resets every time the dialog opens, even over values typed last time', () => {
		expect(shouldResetPlanForm({ open: true, wasOpen: false, isDirty: true })).toBe(true);
		expect(shouldResetPlanForm({ open: true, wasOpen: false, isDirty: false })).toBe(true);
	});

	it('follows a new suggestion while open, as long as nothing has been typed', () => {
		expect(shouldResetPlanForm({ open: true, wasOpen: true, isDirty: false })).toBe(true);
	});

	it('never replaces what the user has typed while the dialog is open', () => {
		expect(shouldResetPlanForm({ open: true, wasOpen: true, isDirty: true })).toBe(false);
	});

	it('does nothing while the dialog is closed', () => {
		expect(shouldResetPlanForm({ open: false, wasOpen: true, isDirty: true })).toBe(false);
		expect(shouldResetPlanForm({ open: false, wasOpen: false, isDirty: false })).toBe(false);
	});
});
