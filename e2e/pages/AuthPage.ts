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
		// ThirdWeb v5 renders the label as text content, not the button's
		// accessible name, so getByRole({name}) matches 0 — filter by text.
		return this.page
			.getByRole('button')
			.filter({ hasText: /connect wallet/i })
			.first();
	}

	/** ThirdWeb's wallet selection modal */
	get walletModal() {
		return this.page.locator('[data-testid="tw-modal"], [role="dialog"]').filter({
			hasText: /wallet|connect/i,
		});
	}

	/** The "Connect a Wallet" button that reveals the external/injected wallet
	 *  list (v5 opens the modal to a "Sign in" view first). */
	get connectAWalletButton() {
		return this.page
			.getByRole('button')
			.filter({ hasText: /connect a wallet/i })
			.first();
	}

	/** The injected wallet option inside the ThirdWeb modal */
	get injectedWalletOption() {
		// Our mock announces as MetaMask via EIP-6963. Match by text content, not
		// accessible name (ThirdWeb's list items expose the label as text).
		return this.page
			.getByRole('button')
			.filter({ hasText: /metamask|hardhat test wallet|injected/i })
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
		// Open the ThirdWeb modal.
		await this.connectButton.click();

		// v5 opens to a "Sign in" view (socials / email / passkey). Click
		// "Connect a Wallet" to reveal the external/injected wallet list.
		await this.connectAWalletButton.click();

		// Select the injected wallet (our mock announces as MetaMask via EIP-6963).
		await expect(this.injectedWalletOption).toBeVisible({ timeout: 10_000 });
		await this.injectedWalletOption.click();

		// The dApp derives the session key by signing a fixed message. The mock
		// wallet signs automatically via Hardhat (no manual prompt), so the sign
		// screen often never appears — only click Sign when it actually shows.
		// Guarding on visibility (instead of swallowing every click error) lets a
		// genuine sign-step failure surface here rather than as a cryptic
		// navigation timeout 20 s later.
		if (await this.signatureScreen.isVisible({ timeout: 5_000 }).catch(() => false)) {
			await this.signButton.click();
		}

		// Authenticated → redirected to the dashboard.
		await this.page.waitForURL('/', { timeout: 20_000 });
	}

	// ── Assertions ────────────────────────────────────────────────────────────

	async assertOnAuthPage() {
		await expect(this.page).toHaveURL(/\/auth/);
		await expect(this.connectButton).toBeVisible();
	}
}
