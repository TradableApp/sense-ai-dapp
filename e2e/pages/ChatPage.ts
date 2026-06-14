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
		return this.page.getByRole('button', { name: /cancel/i }).first();
	}

	/** "Cancelled" status shown on a prompt the user cancelled (see T-REFUND-02). */
	get cancelledStatus() {
		return this.page.getByText(/cancelled|canceled/i).first();
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

	/** The branch/split button on AI messages */
	get branchButton() {
		return this.page.getByRole('button', { name: /branch|split/i }).first();
	}

	/** Error toast shown when a token-costing action can't be covered by the wallet
	 *  balance (ERC20InsufficientBalance — see useChatMutations buildErrorHandler). */
	get insufficientBalanceToast() {
		return this.page.getByText(/insufficient ABLE balance/i).first();
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

	// ── Actions ───────────────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/chat');
	}

	async sendPrompt(text: string) {
		await expect(this.promptTextarea).toBeVisible({ timeout: 5_000 });
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
	 * Cancels the in-flight prompt. The Cancel button is only enabled during the 3s
	 * CANCELLATION_TIMEOUT window after the prompt is submitted (it shows a
	 * "Cancel (Ns)" countdown), so click promptly once it appears.
	 */
	async cancelPendingPrompt() {
		await expect(this.cancelButton).toBeEnabled({ timeout: 30_000 });
		await this.cancelButton.click();
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
		await expect(this.promptTextarea).toBeVisible({ timeout: 5_000 });
	}

	async assertNoPlanCTA() {
		await expect(this.activatePlanCTA).toBeVisible({ timeout: 5_000 });
	}

	async assertSendButtonDisabled() {
		await expect(this.submitButton).toBeDisabled();
	}
}
