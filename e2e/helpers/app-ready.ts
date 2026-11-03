import { expect, type Page } from '@playwright/test';

/**
 * App-ready, not networkidle. The dApp never idles on a live chain: the live-state probe
 * (src/hooks/liveStateProbe.ts) polls every block and Thirdweb and Sentry keep their own traffic
 * up, so `waitForLoadState('networkidle')` times out at 30 s with the page fully rendered (it did
 * for T-INIT-06..10 and T-UI-08 on the 2026-11-02 Base Sepolia run day). The SenseAI logo is
 * rendered by both the auth screen and the app shell, so it is the first thing every route shows
 * once React has mounted. The `no-networkidle` guard forbids the old wait anywhere in the suite.
 */
export async function waitForAppShell(page: Page, timeoutMs = 30_000): Promise<void> {
	await expect(page.locator('img[alt*="SenseAI"]').first()).toBeVisible({ timeout: timeoutMs });
}
