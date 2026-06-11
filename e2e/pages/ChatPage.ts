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
	 * Regenerates the latest answer (default mode). "Try again" is a dropdown
	 * trigger (button) that opens a menu; the default regenerate is the "Try again"
	 * menu item (see components/ai/message-actions.tsx).
	 */
	async regenerate() {
		await this.regenerateButton.click();
		await this.page.getByRole('menuitem', { name: /try again/i }).first().click();
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
