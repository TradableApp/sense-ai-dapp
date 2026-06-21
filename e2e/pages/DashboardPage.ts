import { expect, type Page } from '@playwright/test';

/**
 * Page Object Model for the Usage Dashboard (/).
 */
export class DashboardPage {
	private readonly page: Page;

	constructor(page: Page) {
		this.page = page;
	}

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
		return this.page
			.getByTestId('plan-allowance')
			.or(this.page.getByText(/able/i).filter({ hasText: /\d/ }).first());
	}

	/** "Manage Plan" button */
	get managePlanButton() {
		return this.page.getByRole('button', { name: /manage plan|manage/i });
	}

	/** The "Spent" value in PlanStatusCard ("<n> ABLE"). Sourced from useUsagePlan →
	 *  spendingLimits.spentAmount, so it reflects the per-prompt cost actually
	 *  debited. Testid-first (matching `allowanceValue`), with a text fallback. */
	get spentValue() {
		return this.page
			.getByTestId('plan-spent-value')
			.or(this.page.getByText('Spent', { exact: true }).locator('..').getByText(/ABLE/).first());
	}

	/** RecentActivityCard */
	get activityCard() {
		return this.page.getByText(/recent activity/i).first();
	}

	/** PlanStatusCard's full-width allowance-gap warning panel, rendered whenever the on-chain
	 *  ERC-20 allowance has fallen below the plan's remaining limit (e.g. after a cancellation/
	 *  refund). The "Authorization Gap" heading itself lives in a hover tooltip; this always-rendered
	 *  panel is the stable signal, so assert on it. */
	get authorizationGapWarning() {
		return this.page.getByText(/your wallet allowance is lower than your plan limit/i).first();
	}

	// ── Stuck-request / refund affordance (PlanStatusCard "Action Required" panel) ──

	/** The "Action Required" stuck-request panel header */
	get actionRequiredPanel() {
		return this.page.getByText(/action required/i);
	}

	/** A stuck request's "Request #<id>" row label. Base locator — add `.first()` at the call
	 *  site for a single-element action/visibility; keep it bare for `toHaveCount(N)`. */
	get stuckRequestRow() {
		return this.page.getByText(/request #/i);
	}

	/** Per-request "Refund" button — only rendered once the request is refundable
	 *  (Date.now() > createdAt + REFUND_TIMEOUT_MS). Base locator (see stuckRequestRow). */
	get refundButton() {
		return this.page.getByRole('button', { name: /^refund$/i });
	}

	/** The "Wait 1h" label shown for a stuck request that is not yet refundable. Base locator. */
	get refundWaitLabel() {
		return this.page.getByText(/^wait 1h$/i);
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

	async assertHasPlan(timeoutMs = 10_000) {
		await expect(this.planStatusCard).toBeVisible({ timeout: timeoutMs });
	}

	async assertNoPlan() {
		await expect(this.getStartedButton).toBeVisible({ timeout: 10_000 });
	}

	async assertLoaded() {
		await expect(this.loadingState).not.toBeVisible({ timeout: 10_000 });
		await expect(this.errorState).not.toBeVisible();
	}
}
