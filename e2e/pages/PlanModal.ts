import { type Page, expect } from '@playwright/test';

/**
 * Page Object Model for ManagePlanModal.
 */
export class PlanModal {
	constructor(private page: Page) {}

	// ── Locators ──────────────────────────────────────────────────────────────

	get modal() {
		return this.page.getByRole('dialog').filter({ hasText: /spending limit|plan|allowance/i });
	}

	get limitInput() {
		return this.modal.getByRole('spinbutton', { name: /limit|amount/i }).or(
			this.modal.getByPlaceholder(/e\.g\.|amount|limit/i),
		).first();
	}

	get daysInput() {
		return this.modal.getByRole('spinbutton', { name: /days|duration/i }).or(
			this.modal.getByPlaceholder(/days|duration/i),
		).first();
	}

	get submitButton() {
		return this.modal.getByRole('button', { name: /set plan|activate|confirm|save/i }).filter({
			hasNot: this.modal.locator('[disabled]'),
		}).first();
	}

	get cancelButton() {
		return this.modal.getByRole('button', { name: /cancel plan|remove plan|cancel spending/i });
	}

	get loadingSpinner() {
		return this.modal.locator('.animate-spin, [data-testid="spinner"]').first();
	}

	get tokenBalance() {
		return this.modal.getByText(/able/i).filter({ hasText: /\d/ }).first();
	}

	get faucetButton() {
		return this.modal.getByRole('button', { name: /request.*token|faucet/i });
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	async fillAndSubmit(limitAble: number, days: number) {
		await expect(this.modal).toBeVisible({ timeout: 5_000 });

		await this.limitInput.clear();
		await this.limitInput.fill(String(limitAble));

		await this.daysInput.clear();
		await this.daysInput.fill(String(days));

		await this.submitButton.click();
	}

	/** Waits for the loading spinner to appear then disappear (tx in progress) */
	async waitForTxCompletion(timeoutMs = 60_000) {
		// Wait for spinner to show
		await expect(this.loadingSpinner).toBeVisible({ timeout: 5_000 }).catch(() => {});
		// Wait for spinner to disappear (tx mined)
		await expect(this.loadingSpinner).not.toBeVisible({ timeout: timeoutMs });
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertOpen() {
		await expect(this.modal).toBeVisible({ timeout: 5_000 });
	}

	async assertClosed() {
		await expect(this.modal).not.toBeVisible({ timeout: 5_000 });
	}
}
