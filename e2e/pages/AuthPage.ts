import { expect, type Page } from '@playwright/test';

/**
 * Page Object Model for the /auth route and the ThirdWeb connect flow.
 */
export class AuthPage {
	private readonly page: Page;

	constructor(page: Page) {
		this.page = page;
	}

	// ── Locators ──────────────────────────────────────────────────────────────

	/** The top-level ThirdWeb ConnectButton rendered on the auth screen */
	get connectButton() {
		return this.page.getByRole('button', { name: /connect wallet/i });
	}

	/** ThirdWeb's wallet selection modal */
	get walletModal() {
		return this.page.locator('[data-testid="tw-modal"], [role="dialog"]').filter({
			hasText: /wallet|connect/i,
		});
	}

	/** The injected wallet option inside the ThirdWeb modal */
	get injectedWalletOption() {
		// ThirdWeb v5 surfaces injected wallets by their announced name.
		// Our mock announces as "Hardhat Test Wallet"; fallback to "MetaMask" label.
		return this.page
			.getByRole('button', { name: /hardhat test wallet|metamask|injected/i })
			.first();
	}

	/** The session key signature screen shown after wallet connect */
	get signatureScreen() {
		return this.page.getByText(/login to senseai/i).or(this.page.getByText(/encrypt and decrypt/i));
	}

	/** The "Sign" or "Confirm" button on the signature screen */
	get signButton() {
		return this.page
			.getByRole('button', { name: /sign|confirm|continue/i })
			.filter({ hasNot: this.page.locator('[disabled]') })
			.first();
	}

	/** Spinner / loading state during key derivation */
	get derivingSpinner() {
		return this.page
			.getByRole('img', { name: /loading/i })
			.or(this.page.locator('[data-testid="spinner"], .animate-spin').first());
	}

	/** Rejection / error state after declining signature */
	get signatureError() {
		return this.page.getByText(/rejected|cancelled|error/i);
	}

	/** Retry button shown on signature rejection */
	get retryButton() {
		return this.page.getByRole('button', { name: /try again|retry/i });
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/auth');
	}

	/**
	 * Full wallet connection flow:
	 * 1. Opens ThirdWeb connect modal
	 * 2. Selects the injected wallet
	 * 3. Waits for the signature screen
	 * 4. Signs the session message
	 * 5. Waits for redirect to /
	 */
	async connectAndSign() {
		// Open the connect modal
		await this.connectButton.click();

		// Select the injected wallet option
		await expect(this.injectedWalletOption).toBeVisible({ timeout: 10_000 });
		await this.injectedWalletOption.click();

		// Wait for the signature screen — ThirdWeb redirects here after connection
		await expect(this.signatureScreen).toBeVisible({ timeout: 10_000 });

		// Click sign — the mock wallet handles personal_sign via Hardhat
		await this.signButton.click();

		// Wait for redirect to the dashboard (/)
		await this.page.waitForURL('/', { timeout: 15_000 });
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertOnAuthPage() {
		await expect(this.page).toHaveURL(/\/auth/);
		await expect(this.connectButton).toBeVisible();
	}
}
