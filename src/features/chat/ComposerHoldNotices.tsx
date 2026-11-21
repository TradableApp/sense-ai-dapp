const BRANCH_HOLD_ID = 'branch-history-hold';
const UNSAVED_HOLD_ID = 'unsaved-send-hold';

const BRANCH_HOLD_TEXT =
	'This branch’s earlier messages have not loaded on this device yet. We keep trying, and you can send a prompt as soon as they are here.';

interface HoldFlags {
	isHeldForBranchHistory: boolean;
	/** Why a paid send not saved here holds the composer (`useUnsavedSendHold`), or null. */
	unsavedSendReason: string | null;
}

/** The ids of the notices that say why the composer is held, for its `aria-describedby`. */
export function composerHoldDescription({
	isHeldForBranchHistory,
	unsavedSendReason,
}: HoldFlags): string | undefined {
	const ids = [
		...(isHeldForBranchHistory ? [BRANCH_HOLD_ID] : []),
		...(unsavedSendReason ? [UNSAVED_HOLD_ID] : []),
	];
	return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Why the composer cannot send, one notice per reason. Always mounted, so a screen reader
 * announces the text when it appears.
 */
export default function ComposerHoldNotices({
	isHeldForBranchHistory,
	unsavedSendReason,
}: HoldFlags) {
	const shown = 'px-3 py-1.5 text-xs text-muted-foreground';
	return (
		<>
			<p
				id={BRANCH_HOLD_ID}
				className={isHeldForBranchHistory ? shown : 'sr-only'}
				role="status"
				data-testid={BRANCH_HOLD_ID}
			>
				{isHeldForBranchHistory && BRANCH_HOLD_TEXT}
			</p>
			<p
				id={UNSAVED_HOLD_ID}
				className={unsavedSendReason ? shown : 'sr-only'}
				role="status"
				data-testid={UNSAVED_HOLD_ID}
			>
				{unsavedSendReason}
			</p>
		</>
	);
}
