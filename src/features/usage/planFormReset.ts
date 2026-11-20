/**
 * Whether the plan dialog should put its form back to the suggested values.
 *
 * The dialog stays mounted while closed, so the form keeps what was typed. Opening it is
 * therefore always a reset: values typed and abandoned last time must not be waiting to be
 * approved by mistake. While it is open the suggestion can still change (the wallet balance
 * arriving), and the form follows it only until the user has typed something.
 */
export default function shouldResetPlanForm({
	open,
	wasOpen,
	isDirty,
}: {
	open: boolean;
	wasOpen: boolean;
	isDirty: boolean;
}): boolean {
	if (!open) return false;
	return !wasOpen || !isDirty;
}
