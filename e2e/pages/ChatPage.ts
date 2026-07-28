import { expect, type Page } from '@playwright/test';

/**
 * Page Object Model for the Chat page (/chat).
 */
export class ChatPage {
	private readonly page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	// ── Locators ──────────────────────────────────────────────────────────────

	get promptTextarea() {
		return this.page
			.getByRole('textbox', { name: /message|prompt|ask/i })
			.or(this.page.locator('textarea[placeholder]').first());
	}

	get submitButton() {
		// The composer's submit button. Its accessible label is status-dependent
		// (Send → Retry on a validation error, Sending while in flight), so match the
		// stable type="submit" rather than the name; assert enabled/disabled in tests.
		return this.page.locator('form button[type="submit"]').last();
	}

	get cancelButton() {
		// Anchor to the start of the accessible name so we match ONLY the composer's
		// cancel control — "Cancel" (icon, aria-label) or "Cancel (Ns)" (countdown) —
		// and never a sidebar conversation title that merely contains the word "cancel".
		return this.page.getByRole('button', { name: /^cancel/i }).first();
	}

	/** The "Prompt Cancelled — tokens refunded" toast shown after a successful cancel.
	 *  It overlaps the composer's Send button. */
	get cancelToast() {
		return this.page.getByText(/tokens refunded/i).first();
	}

	/**
	 * Closes the cancel toast so it stops overlapping the composer's Send button.
	 * Sonner PAUSES its auto-dismiss timer when the page isn't focused (always the case
	 * in headless Playwright), so waiting for it to disappear on its own hangs — close it
	 * via its close button instead (the Toaster is mounted with `closeButton`).
	 */
	async dismissCancelToast() {
		await this.page.locator('[data-close-button]').first().click({ timeout: 5_000 });
		await expect(this.cancelToast).toBeHidden({ timeout: 5_000 });
	}

	/** Loading / thinking indicator while awaiting oracle response. The assistant
	 *  message renders a Reasoning block ("Thinking…") while content is empty. */
	get thinkingIndicator() {
		return this.page.getByText(/thinking/i).first();
	}

	/** All AI response bubbles. The `.is-assistant` class is only present once the
	 *  answer HAS content (a content-less "Thinking…" placeholder renders no bubble),
	 *  so the count increments by one per delivered answer. */
	get assistantMessages() {
		return this.page.locator('.is-assistant');
	}

	/** The last AI response message. Message bubbles carry an `.is-assistant`
	 *  class (see components/ai/message.tsx); user bubbles carry `.is-user`. */
	get latestAiMessage() {
		return this.page.locator('.is-assistant').last();
	}

	/** All user messages in the conversation */
	get userMessages() {
		return this.page.locator('.is-user');
	}

	/** "No active plan" CTA shown when user has no spending limit */
	get activatePlanCTA() {
		return this.page.getByText(/activate.*plan|set.*limit|get started/i).first();
	}

	/** The regenerate affordance on AI messages — a "Try again" dropdown trigger
	 *  (see components/ai/message-actions.tsx) that opens regenerate options. */
	get regenerateButton() {
		return this.page.getByRole('button', { name: /try again/i }).first();
	}

	/** The "More actions" menu trigger on an AI message — it contains "Branch in new chat"
	 *  (see components/ai/message-actions.tsx). Use `.last()` so multi-answer threads target the
	 *  most recent answer. NOTE: a bare /branch|split/i button query wrongly matches sidebar
	 *  conversation titles that contain the word "branch". */
	get branchTrigger() {
		return this.page.getByRole('button', { name: /more actions/i }).last();
	}

	/** Branch the latest AI answer into a new conversation: open "More actions" → "Branch in
	 *  new chat" (a DropdownMenuItem, not a standalone button). */
	async branchInNewChat() {
		await this.branchTrigger.click();
		await this.page.getByRole('menuitem', { name: /branch in new chat/i }).click();
	}

	/** Error toast shown when a token-costing action can't be covered by the wallet
	 *  balance (ERC20InsufficientBalance — see useChatMutations buildErrorHandler). */
	get insufficientBalanceToast() {
		return this.page.getByText(/insufficient ABLE balance/i).first();
	}

	// ── Reasoning / sources (answer disclosure) ─────────────────────────────────
	// An answer carrying reasoning renders a collapsible disclosure above the bubble
	// (components/ai/reasoning.tsx). With a reasoningDuration its trigger reads "Thought
	// for N seconds"; expanding it reveals the steps ({title, description}) and a nested
	// "Used N sources" disclosure (source.tsx) of {title, url} links.

	get reasoningTrigger() {
		return this.page.getByRole('button', { name: /thought for \d+ seconds?/i }).first();
	}

	/** The nested "Used N sources" disclosure inside an expanded reasoning block. */
	get sourcesTrigger() {
		return this.page.getByRole('button', { name: /used \d+ sources?/i }).first();
	}

	/** A reasoning step's title — rendered specifically as an <h4> heading (level 4) inside the
	 *  expanded block, so it can't collide with a page heading of the same text. */
	reasoningStep(title: string) {
		return this.page.getByRole('heading', { name: title, level: 4 });
	}

	/** A rendered source link (opens in a new tab). Scoped to the expanded reasoning panel (the
	 *  open collapsible holding the "Used N sources" disclosure) so it can never match a nav,
	 *  footer, or onboarding link that happens to share the title. */
	sourceLink(title: string) {
		return this.page
			.locator('[data-state="open"]')
			.filter({ hasText: /used \d+ sources?/i })
			.getByRole('link', { name: title });
	}

	// ── Answer versions (regenerations / prompt edits) ──────────────────────────
	// Regenerating an answer or editing a prompt creates a SIBLING (a new "version"),
	// not a second bubble. The message renders one version at a time with a
	// "‹ {i} / {n} ›" pager (see message-actions.tsx / user-message-actions.tsx),
	// shown only when siblings.length > 1. In a per-flow test exactly one message
	// (the answer for regenerate, the prompt for edit) carries the pager.

	get prevVersionButton() {
		return this.page.getByRole('button', { name: 'Previous version' }).first();
	}

	get nextVersionButton() {
		return this.page.getByRole('button', { name: 'Next version' }).first();
	}

	/** The "{currentIndex + 1} / {siblings.length}" counter between the chevrons. */
	get versionIndicator() {
		return this.page.getByText(/^\s*\d+\s*\/\s*\d+\s*$/).first();
	}

	/** The "Reset Chat" button — clears the active conversation so the next prompt starts a
	 *  brand-new one (see Chat.tsx handleReset → clearActiveConversation). */
	get resetChatButton() {
		return this.page.getByRole('button', { name: /reset chat/i });
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/chat');
	}

	/** Start a fresh conversation: clear the active one, so the next prompt creates a new
	 *  conversation rather than appending to the current thread. The textarea is visible both
	 *  before and after the reset, so that's not a usable barrier — wait for the prior thread's
	 *  messages to clear (proof the reset propagated through Redux) before the next sendPrompt. */
	async startNewConversation() {
		await this.resetChatButton.click();
		await expect(this.assistantMessages).toHaveCount(0, { timeout: 5_000 });
		await expect(this.userMessages).toHaveCount(0, { timeout: 5_000 });
	}

	/** Composer visibility with a self-diagnosing failure: the composer is
	 *  plan-gated, and without this check a missing plan surfaces an opaque
	 *  "locator not found" a long way from its cause (a full debugging session
	 *  went into exactly that). */
	async assertComposerReady() {
		try {
			// 15s, not 5s: on a state-heavy localnet chain first render can push past 5s.
			await expect(this.promptTextarea).toBeVisible({ timeout: 15_000 });
		} catch (err) {
			// isVisible() resolves false for an absent element rather than throwing, so this
			// catch only ever fires on a GENUINE error (page crashed, context torn down). It
			// must not swallow that silently: the original composer error is still the one
			// worth reporting, so keep re-throwing it, but say that the gate probe itself
			// failed — otherwise a crashed page is indistinguishable from "not plan-gated".
			const planGated = await this.page
				.getByText('Activate Your Agent')
				.isVisible()
				.catch((probeErr: unknown) => {
					console.warn(
						`[assertComposerReady] plan-gate probe failed (${probeErr}) — cannot tell whether ` +
							'the composer was plan-gated; reporting the original composer error below.',
					);
					return false;
				});
			if (planGated) {
				throw new Error(
					"Chat composer is plan-gated: 'Activate Your Agent' is showing — this account has no active plan. " +
						'Call fundAndActivatePlan(<address>) in beforeEach (e2e/helpers/contracts.ts).',
					// Chain the original: the diagnosis explains WHY, but Playwright's own
					// error carries the locator, timing and trace attachment that make a
					// flaky run diagnosable. Replacing it outright loses that.
					{ cause: err },
				);
			}
			throw err;
		}
	}

	async sendPrompt(text: string) {
		await this.assertComposerReady();
		await this.promptTextarea.fill(text);
		// Validity (react-hook-form, onChange) enables the submit once the prompt is
		// non-empty — wait for that rather than clicking a still-disabled button.
		await expect(this.submitButton).toBeEnabled({ timeout: 5_000 });
		await this.submitButton.click();
	}

	/**
	 * Sends a prompt and waits for a NEW oracle response to render. Waits for the
	 * assistant-bubble count to increment (not just "any bubble visible"), so it
	 * works for follow-up prompts in a conversation that already has answers — the
	 * answer arrives live via useLiveResponse's event + fallback-poll path (see
	 * src/hooks/useLiveResponse.ts), no navigation needed. Default timeout allows
	 * oracle processing + the poll's catch-up.
	 */
	async sendPromptAndWaitForResponse(text: string, timeoutMs = 90_000) {
		const before = await this.assistantMessages.count();
		await this.sendPrompt(text);
		await expect(this.assistantMessages).toHaveCount(before + 1, { timeout: timeoutMs });
		return this.latestAiMessage.textContent();
	}

	/**
	 * Sends a prompt that the mock oracle holds PENDING for `delayMs` (via the
	 * `__E2E_DELAY_MS__:<n>` sentinel — see tokenized-ai-agent oracle parseMockDelayMs).
	 * Gives a deterministic window to cancel before the answer can land, and keeps the
	 * pending state stable for assertions. Does NOT wait for a response.
	 */
	async sendDelayedPrompt(text: string, delayMs: number) {
		await this.sendPrompt(`${text} __E2E_DELAY_MS__:${delayMs}`);
	}

	/**
	 * Sends a prompt the mock oracle NEVER answers (via the `__E2E_DROP__` sentinel — see
	 * tokenized-ai-agent oracle hasMockDropSentinel). The on-chain job stays unfinalized, so
	 * the prompt is genuinely pending forever — the deterministic precondition for the refund
	 * flow (forward EVM time past REFUND_TIMEOUT, then claim). Does NOT wait for a response.
	 */
	async sendDroppedPrompt(text: string) {
		await this.sendPrompt(`${text} __E2E_DROP__`);
	}

	/**
	 * Sends a prompt with the `__E2E_REASONING__` sentinel so the mock oracle attaches
	 * deterministic reasoning + sources to the answer MessageFile (see tokenized-ai-agent
	 * hasMockReasoningSentinel), then waits for the answer to render — so the reasoning/sources
	 * disclosure is present to assert.
	 */
	async sendReasoningPrompt(text: string, timeoutMs = 90_000) {
		return this.sendPromptAndWaitForResponse(`${text} __E2E_REASONING__`, timeoutMs);
	}

	/**
	 * Regenerates the latest answer. "Try again" is a dropdown trigger (button) that
	 * opens a menu with three modes (see components/ai/message-actions.tsx):
	 *   default  → "Try again"     (instructions: 'better')
	 *   detailed → "Add details"   (instructions: 'more detailed')
	 *   concise  → "More concise"  (instructions: 'more concise')
	 */
	async regenerate(mode: 'default' | 'detailed' | 'concise' = 'default') {
		await this.regenerateButton.click();
		const itemName =
			mode === 'detailed' ? /add details/i : mode === 'concise' ? /more concise/i : /try again/i;
		await this.page.getByRole('menuitem', { name: itemName }).first().click();
	}

	/**
	 * Regenerates and waits for the answer to SWITCH to the new version. With version
	 * semantics the answer is replaced (not appended): the pager advances to
	 * "{expectedVersions} / {expectedVersions}" and the new answer re-hydrates (the
	 * active assistant bubble briefly shows "Thinking…" then renders content again).
	 */
	async regenerateAndWaitForNewVersion(
		mode: 'default' | 'detailed' | 'concise',
		expectedVersions: number,
		timeoutMs = 90_000,
	) {
		await this.regenerate(mode);
		await expect(this.versionIndicator).toHaveText(
			new RegExp(`^\\s*${expectedVersions}\\s*/\\s*${expectedVersions}\\s*$`),
			{ timeout: timeoutMs },
		);
		// The regenerated answer hydrated — content rendered, not stuck on "Thinking…".
		await expect(this.thinkingIndicator).toBeHidden({ timeout: timeoutMs });
		await expect(this.assistantMessages).toHaveCount(1);
	}

	/**
	 * Edit the latest user message to `newText`, producing a new prompt+answer version
	 * (a sibling of the original prompt — see Chat.tsx handleSaveEdit). Opens the inline
	 * editor (its textarea autofocuses) and submits with Enter.
	 */
	async editLatestUserMessage(newText: string) {
		await this.userMessages.last().hover();
		await this.page.getByRole('button', { name: 'Edit message' }).first().click();
		// The inline editor REPLACES the user bubble, and `:focus` is flaky (a React
		// re-render can blur the textarea while Playwright resolves the locator). Scope
		// to the edit form instead — it's the only PromptInput carrying a "Cancel"
		// button (the composer shows Cancel only while a prompt is pending, which it
		// isn't here since the answer already rendered).
		const editForm = this.page
			.locator('form')
			.filter({ has: this.page.getByRole('button', { name: 'Cancel', exact: true }) });
		const editor = editForm.locator('textarea');
		await editor.fill(newText);
		await editor.press('Enter');
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertPromptInputVisible() {
		await expect(this.promptTextarea).toBeVisible({ timeout: 15_000 });
	}

	async assertNoPlanCTA() {
		await expect(this.activatePlanCTA).toBeVisible({ timeout: 5_000 });
	}

	async assertSendButtonDisabled() {
		await expect(this.submitButton).toBeDisabled();
	}
}
