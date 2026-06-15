import { expect, type Page } from '@playwright/test';

/**
 * Page Object Model for the History page (/history).
 *
 * Locators target the real History UI (src/features/history/History.tsx): conversation rows
 * carry `data-testid="conversation-item"`, the empty state carries `data-testid="history-empty"`,
 * the per-row action menu trigger is labelled "Toggle menu" (sr-only), rename opens a Dialog
 * (placeholder "Conversation title", submit "Rename"), and delete opens an AlertDialog (confirm
 * "Continue").
 */
export class HistoryPage {
	private readonly page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	// ── Locators ──────────────────────────────────────────────────────────────

	get searchInput() {
		return this.page.getByPlaceholder(/search history/i);
	}

	get conversationItems() {
		return this.page.getByTestId('conversation-item');
	}

	get emptyState() {
		return this.page.getByTestId('history-empty');
	}

	/** "No results found." is shown when a search matches nothing (distinct from the
	 *  no-conversations-at-all empty state). */
	get noResults() {
		return this.page.getByText(/no results found/i);
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
		await this.conversationItems
			.nth(index)
			.getByRole('button', { name: /toggle menu/i })
			.click();
	}

	async renameConversation(index: number, newName: string) {
		await this.openConversationMenu(index);
		await this.page.getByRole('menuitem', { name: /rename/i }).click();
		const dialog = this.page.getByRole('dialog');
		await dialog.getByPlaceholder(/conversation title/i).fill(newName);
		await dialog.getByRole('button', { name: /rename/i }).click();
	}

	async deleteConversation(index: number) {
		await this.openConversationMenu(index);
		await this.page.getByRole('menuitem', { name: /delete/i }).click();
		// AlertDialog confirm — the destructive action button is "Continue".
		await this.page.getByRole('alertdialog').getByRole('button', { name: /continue/i }).click();
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
		await expect(this.emptyState).toBeVisible({ timeout: 10_000 });
	}
}
