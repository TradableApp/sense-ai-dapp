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
		return this.page
			.getByRole('button', { name: /send/i })
			.filter({ hasNot: this.page.locator('[disabled]') })
			.first();
	}

	get cancelButton() {
		return this.page.getByRole('button', { name: /cancel/i }).first();
	}

	/** Loading / thinking indicator while awaiting oracle response */
	get thinkingIndicator() {
		return this.page.locator('[data-testid="thinking"], .animate-pulse, [class*="loader"]').first();
	}

	/** The last AI response message in the conversation */
	get latestAiMessage() {
		return this.page.locator('[data-testid="ai-message"], [class*="assistant-message"]').last();
	}

	/** All user messages in the conversation */
	get userMessages() {
		return this.page.locator('[data-testid="user-message"], [class*="user-message"]');
	}

	/** "No active plan" CTA shown when user has no spending limit */
	get activatePlanCTA() {
		return this.page.getByText(/activate.*plan|set.*limit|get started/i).first();
	}

	/** The regenerate button on AI messages */
	get regenerateButton() {
		return this.page.getByRole('button', { name: /regenerate|retry/i }).first();
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
