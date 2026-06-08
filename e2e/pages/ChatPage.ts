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
	 * Sends a prompt and waits for the oracle response to appear.
	 * Times out after `timeoutMs` (default 90s to allow oracle processing).
	 */
	async sendPromptAndWaitForResponse(text: string, timeoutMs = 90_000) {
		await this.sendPrompt(text);
		await expect(this.latestAiMessage).toBeVisible({ timeout: timeoutMs });
		return this.latestAiMessage.textContent();
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
