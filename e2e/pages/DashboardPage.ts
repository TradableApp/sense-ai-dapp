import { type Page, expect } from '@playwright/test';

/**
 * Page Object Model for the Usage Dashboard (/).
 */
export class DashboardPage {
	constructor(private page: Page) {}

	// ── Locators ──────────────────────────────────────────────────────────────

	/** Onboarding flow shown to new users with no plan */
	get onboardingFlow() {
		return this.page.locator('[class*="warp"], [data-testid="onboarding"]').first();
	}

	/** "Get Started" CTA on the onboarding screen */
	get getStartedButton() {
		return this.page.getByRole('button', { name: /get started/i });
	}

	/** PlanStatusCard shown to users with an active plan */
	get planStatusCard() {
		return this.page.getByText(/usage allowance|spending limit/i).first();
	}

	/** Allowance value displayed in the plan card */
	get allowanceValue() {
		return this.page.getByTestId('plan-allowance').or(
			this.page.getByText(/able/i).filter({ hasText: /\d/ }).first(),
		);
	}

	/** "Manage Plan" button */
	get managePlanButton() {
		return this.page.getByRole('button', { name: /manage plan|manage/i });
	}

	/** RecentActivityCard */
	get activityCard() {
		return this.page.getByText(/recent activity/i).first();
	}

	/** Loading state */
	get loadingState() {
		return this.page.getByText(/loading your usage plan/i);
	}

	/** Error state */
	get errorState() {
		return this.page.getByText(/failed to load usage plan/i);
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/');
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertHasPlan() {
		await expect(this.planStatusCard).toBeVisible({ timeout: 10_000 });
	}

	async assertNoPlan() {
		await expect(this.getStartedButton).toBeVisible({ timeout: 10_000 });
	}

	async assertLoaded() {
		await expect(this.loadingState).not.toBeVisible({ timeout: 10_000 });
		await expect(this.errorState).not.toBeVisible();
	}
}
