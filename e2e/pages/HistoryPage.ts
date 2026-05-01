import { type Page, expect } from '@playwright/test';

/**
 * Page Object Model for the History page (/history).
 */
export class HistoryPage {
	constructor(private page: Page) {}

	// ── Locators ──────────────────────────────────────────────────────────────

	get searchInput() {
		return this.page.getByRole('searchbox').or(
			this.page.getByPlaceholder(/search/i),
		).first();
	}

	get conversationList() {
		return this.page.locator('[data-testid="conversation-list"], ul, [role="list"]').first();
	}

	get conversationItems() {
		return this.page.locator('[data-testid="conversation-item"], [role="listitem"]');
	}

	get newChatButton() {
		return this.page.getByRole('button', { name: /new chat/i });
	}

	get emptyState() {
		return this.page.getByText(/no conversations|start.*conversation|nothing here/i);
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/history');
	}

	async searchFor(text: string) {
		await this.searchInput.fill(text);
	}

	async clearSearch() {
		await this.searchInput.clear();
	}

	async openConversationMenu(index: number) {
		const item = this.conversationItems.nth(index);
		await item.hover();
		await item.getByRole('button', { name: /more|options|\.\.\./i }).click();
	}

	async renameConversation(index: number, newName: string) {
		await this.openConversationMenu(index);
		await this.page.getByRole('menuitem', { name: /rename/i }).click();
		const input = this.page.getByRole('textbox', { name: /name/i });
		await input.clear();
		await input.fill(newName);
		await this.page.getByRole('button', { name: /save|confirm/i }).click();
	}

	async deleteConversation(index: number) {
		await this.openConversationMenu(index);
		await this.page.getByRole('menuitem', { name: /delete/i }).click();
		// Confirm the alert dialog
		await this.page.getByRole('button', { name: /delete|confirm/i }).last().click();
	}

	async clickConversation(index: number) {
		await this.conversationItems.nth(index).click();
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertConversationCount(count: number) {
		await expect(this.conversationItems).toHaveCount(count, { timeout: 10_000 });
	}

	async assertHasConversations() {
		await expect(this.conversationItems.first()).toBeVisible({ timeout: 10_000 });
	}

	async assertEmpty() {
		await expect(this.emptyState).toBeVisible({ timeout: 5_000 });
	}
}
