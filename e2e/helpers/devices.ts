import { type Browser, type BrowserContext, type Page } from '@playwright/test';

import { type HardhatAccount } from './hardhat';
import { buildMockWalletScript } from '../fixtures/mock-wallet';
import { AuthPage } from '../pages/AuthPage';
import { ChatPage } from '../pages/ChatPage';
import { DashboardPage } from '../pages/DashboardPage';
import { HistoryPage } from '../pages/HistoryPage';
import { PlanModal } from '../pages/PlanModal';

/** A connected "device": a fresh BrowserContext (its own empty IndexedDB) with every POM bound to
 *  its page. Used by the multi-device / live-sync specs to run two independent browsers concurrently. */
export interface Device {
	page: Page;
	chat: ChatPage;
	history: HistoryPage;
	dashboard: DashboardPage;
	planModal: PlanModal;
}

/**
 * Opens a brand-new "device" — a fresh BrowserContext (its own empty IndexedDB) whose mock wallet
 * impersonates `account`, then completes the real connect + session-key signature. Two devices on
 * the SAME account derive the SAME session key (SIGNATURE_MESSAGE is fixed and Hardhat signing is
 * deterministic), so device B can decrypt device A's data; two DIFFERENT accounts derive different
 * keys and query the subgraph under a different owner, so they stay isolated.
 *
 * The context is pushed onto `openContexts` so the caller's `afterEach` can close it even if the
 * test fails mid-body (no leaked worker-scoped BrowserContext).
 */
export async function openDevice(
	browser: Browser,
	account: HardhatAccount,
	openContexts: BrowserContext[],
): Promise<Device> {
	const context = await browser.newContext();
	openContexts.push(context);
	await context.addInitScript(buildMockWalletScript(account));
	const page = await context.newPage();
	await page.goto('/');
	await new AuthPage(page).connectAndSign();
	return {
		page,
		chat: new ChatPage(page),
		history: new HistoryPage(page),
		dashboard: new DashboardPage(page),
		planModal: new PlanModal(page),
	};
}

/** Extracts the leading numeric amount from a displayed "<n> ABLE" string (e.g. "12.5 ABLE" → 12.5). */
export function parseAble(text: string): number {
	const match = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
	return match ? Number(match[0]) : NaN;
}
