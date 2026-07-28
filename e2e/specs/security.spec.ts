import { test as base, expect } from '@playwright/test';

import { test } from '../fixtures';
import { injectMockWallet } from '../fixtures/mock-wallet';
import { ESCROW_ADDRESS, fundAndActivatePlan, TOKEN_ADDRESS } from '../helpers/contracts';

const SKIP_REASON =
	'Skipped: requires Hardhat node for wallet signing and storage inspection (set E2E_LOCAL_SERVICES=1)';

test.describe('Security — route protection (T-SEC-ROUTE)', () => {
	const unauthTest = base;

	unauthTest('T-SEC-01: /chat redirects to /auth without connected wallet', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/chat');
		await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
	});

	unauthTest('T-SEC-02: /history redirects to /auth without connected wallet', async ({ page }) => {
		await injectMockWallet(page);
		await page.goto('/history');
		await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
	});

	unauthTest(
		'T-SEC-03: / (dashboard) redirects to /auth without connected wallet',
		async ({ page }) => {
			await injectMockWallet(page);
			await page.goto('/');
			await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
		},
	);
});

test.describe('Security — session and storage (T-SEC-SESSION)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);

	test('T-SEC-04: Session key is not persisted to localStorage', async ({ authenticatedPage }) => {
		const hasSessionKey = await authenticatedPage.evaluate(() => {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i) ?? '';
				const value = localStorage.getItem(key) ?? '';
				if (
					key.toLowerCase().includes('sessionkey') ||
					key.toLowerCase().includes('session_key') ||
					key.toLowerCase().includes('cryptokey')
				) {
					return true;
				}
				// Check if any value looks like a raw CryptoKey or hex key
				if (/^[0-9a-f]{64}$/i.test(value)) {
					return true;
				}
			}
			return false;
		});
		expect(hasSessionKey).toBe(false);
	});

	test('T-SEC-05: Session key is not persisted to sessionStorage', async ({
		authenticatedPage,
	}) => {
		const hasSessionKey = await authenticatedPage.evaluate(() => {
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i) ?? '';
				if (key.toLowerCase().includes('sessionkey') || key.toLowerCase().includes('cryptokey')) {
					return true;
				}
			}
			return false;
		});
		expect(hasSessionKey).toBe(false);
	});

	// T-SEC-06 (no plaintext prompts in IndexedDB) moved to the T-SEC-CRYPTO block below — it
	// needs a funded wallet with an active plan to actually send a prompt, so it now runs on a
	// fresh account instead of the planless cached Account #1 (where the composer never appears).

	// T-SEC-07 (a different wallet sees different conversation history) is now implemented as a
	// real two-context cross-layer test in multi-device.spec.ts (T-MULTI-02 / T-SEC-07), which the
	// second-device fixture this stub was waiting on made possible.
});

// Encryption at rest (IndexedDB) and in transit (contract calldata). These send a real prompt, so
// they need a funded wallet with an active plan — they run on a FRESH account (fund + activate in
// beforeEach, page connects after) rather than the planless cached Account #1 they were stranded on.
test.describe('Security — encryption at rest and in transit (T-SEC-CRYPTO)', () => {
	test.skip(process.env.E2E_LOCAL_SERVICES !== '1', SKIP_REASON);
	test.skip(!TOKEN_ADDRESS || !ESCROW_ADDRESS, 'Skipped: contract addresses not set');

	test.beforeEach(async ({ freshUserAccount }) => {
		await fundAndActivatePlan(freshUserAccount.address);
	});

	test('T-SEC-06: No plaintext prompts in IndexedDB', async ({ freshChatPage, freshPage }) => {
		const testPrompt = `SEC_TEST_PLAINTEXT_MARKER_${Date.now()}`;
		await freshChatPage.goto();
		await freshChatPage.sendPromptAndWaitForResponse(testPrompt);

		const foundPlaintext = await freshPage.evaluate(async (marker: string) => {
			const idb = window.indexedDB;
			const dbs = await idb.databases();
			for (let i = 0; i < dbs.length; i++) {
				const dbInfo = dbs[i];
				if (!dbInfo.name) {
					// skip unnamed databases
				} else {
					try {
						const db = await new Promise<ReturnType<typeof idb.open>['result']>(
							(resolve, reject) => {
								const req = idb.open(dbInfo.name!);
								req.onsuccess = () => resolve(req.result);
								req.onerror = () => reject(req.error);
							},
						);
						for (const storeName of db.objectStoreNames) {
							const tx = db.transaction(storeName, 'readonly');
							const store = tx.objectStore(storeName);
							const all: unknown[] = await new Promise((resolve, reject) => {
								const req = store.getAll();
								req.onsuccess = () => resolve(req.result as unknown[]);
								req.onerror = () => reject(req.error);
							});
							const stringified = JSON.stringify(all);
							if (stringified.includes(marker)) {
								db.close();
								return true;
							}
						}
						db.close();
					} catch {
						// skip inaccessible databases
					}
				}
			}
			return false;
		}, testPrompt);

		expect(foundPlaintext, 'Plaintext prompt found in IndexedDB — encryption may be broken').toBe(
			false,
		);
	});

	test('T-SEC-08: Contract calldata does not contain plaintext prompt', async ({
		freshChatPage,
		freshPage,
	}) => {
		const testPrompt = `ECIES_PLAINTEXT_CHECK_${Date.now()}`;

		// Intercept the eth_sendTransaction RPC call to inspect calldata. fundABLE/activatePlan run
		// off-page (direct RPC), so the first on-page eth_sendTransaction is the prompt itself.
		const txDataPromise = new Promise<string>(resolve => {
			freshPage.on('request', req => {
				if (req.url().includes('8545') && req.method() === 'POST') {
					try {
						const body = JSON.parse(req.postData() ?? '{}');
						if (body.method === 'eth_sendTransaction' && body.params?.[0]?.data) {
							resolve(body.params[0].data);
						}
					} catch {
						// not JSON — skip
					}
				}
			});
		});

		await freshChatPage.goto();
		await freshChatPage.sendPrompt(testPrompt);

		const txData = await Promise.race([
			txDataPromise,
			new Promise<string>((_, reject) =>
				setTimeout(() => reject(new Error('No eth_sendTransaction observed within 30s')), 30_000),
			),
		]);

		expect(txData.length, 'Transaction calldata should not be empty').toBeGreaterThan(0);
		const hexPrompt = Buffer.from(testPrompt).toString('hex');
		expect(txData.toLowerCase()).not.toContain(hexPrompt.toLowerCase());
	});
});
