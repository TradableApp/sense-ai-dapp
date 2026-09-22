import { describe, expect, it } from 'vitest';

import { shouldUseAppCheckDebugToken } from './appCheckDebug';

/**
 * App Check exists to stop anything but the real app calling our Firebase backend. A debug token
 * is an explicit bypass of that: Firebase treats a request carrying a registered debug token as
 * attested without any attestation.
 *
 * The gate was `import.meta.env.DEV || import.meta.env.VITE_APP_DEBUG`. DEV is false in every
 * build, but VITE_APP_DEBUG is just an env var — and Vite INLINES it at build time, so a
 * production build made with it set ships a permanent App Check bypass to every user, with the
 * token itself baked into the bundle for anyone to read and reuse.
 */

describe('shouldUseAppCheckDebugToken', () => {
	it('allows a debug token in local development', () => {
		expect(shouldUseAppCheckDebugToken({ dev: true, mode: 'development', debugFlag: '1', token: 'tok' })).toBe(true);
	});

	it('allows an explicitly flagged non-production build', () => {
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'localnet', debugFlag: '1', token: 'tok' })).toBe(true);
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'testnet', debugFlag: '1', token: 'tok' })).toBe(true);
	});

	it('REFUSES in a production build even when the debug flag is set', () => {
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'production', debugFlag: '1', token: 'tok' })).toBe(false);
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'mainnet', debugFlag: '1', token: 'tok' })).toBe(false);
	});

	it('REFUSES in production even if DEV is somehow true', () => {
		// Belt and braces: the production mode is the authority, not the DEV flag.
		expect(shouldUseAppCheckDebugToken({ dev: true, mode: 'mainnet', debugFlag: '1', token: 'tok' })).toBe(false);
	});

	it('refuses when no token is configured, rather than setting undefined on window', () => {
		expect(shouldUseAppCheckDebugToken({ dev: true, mode: 'development', debugFlag: '1', token: undefined })).toBe(false);
		expect(shouldUseAppCheckDebugToken({ dev: true, mode: 'development', debugFlag: '1', token: '' })).toBe(false);
	});

	it('refuses when neither DEV nor the debug flag is set', () => {
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'testnet', debugFlag: undefined, token: 'tok' })).toBe(false);
	});
});
