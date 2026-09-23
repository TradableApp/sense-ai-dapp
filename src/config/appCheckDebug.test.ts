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

	// BEHAVIOUR DELIBERATELY CHANGED, not a weakened assertion. This case previously expected a
	// flagged localnet/testnet BUILD to carry a debug token. It must not: build:testnet is what
	// deploys to the sense-ai-app-staging and sense-ai-app-dev hosting targets, so that artefact
	// reaches real browsers. Debug tokens are now confined to the dev server, which is never
	// deployed. The original intent -- "a flag can enable debugging outside production" -- is
	// preserved below for the dev server, which is where it was actually useful.
	it('REFUSES a flagged non-production BUILD, because builds get deployed', () => {
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'localnet', debugFlag: '1', token: 'tok' })).toBe(false);
		expect(shouldUseAppCheckDebugToken({ dev: false, mode: 'testnet', debugFlag: '1', token: 'tok' })).toBe(false);
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

	// A list of modes to REFUSE fails open: the next mode anyone adds is eligible by default,
	// and the failure is silent — a shipped App Check bypass, discovered by whoever finds the
	// token in the bundle. Listing the modes that may debug fails closed instead, so a new mode
	// has to be added deliberately.
	it.each(['staging', 'prod', 'mainnet-preview', 'preprod', 'canary', ''])(
		'REFUSES an unrecognised build mode %j',
		(mode) => {
			expect(shouldUseAppCheckDebugToken({ dev: false, mode, debugFlag: '1', token: 'tok' })).toBe(
				false,
			);
		},
	);

	it('still refuses an unrecognised mode even when DEV is true', () => {
		expect(
			shouldUseAppCheckDebugToken({ dev: true, mode: 'staging', debugFlag: '1', token: 'tok' }),
		).toBe(false);
	});

	// THE BUG THE EARLIER GATES ALL SHARED. Vite inlines VITE_* as STRINGS, so the env files'
	// `VITE_APP_DEBUG=false` arrives as the string "false" -- which is truthy. Every previous
	// version of this gate ended in `Boolean(dev || debugFlag)` and therefore evaluated to TRUE
	// for a build that had explicitly disabled debugging. Verified against a real `build:testnet`
	// bundle: the token was inlined and assigned to window.
	//
	// No earlier test caught it because they all passed '1' or undefined -- never the literal
	// value every real env file actually sets.
	it.each(['false', 'FALSE', '0', 'no', 'off'])(
		'REFUSES when the debug flag is the string %j, which is truthy in JS',
		(debugFlag) => {
			expect(
				shouldUseAppCheckDebugToken({ dev: false, mode: 'testnet', debugFlag, token: 'tok' }),
			).toBe(false);
		},
	);

	// testnet is a DEPLOYED mode: build:testnet feeds the sense-ai-app-staging and
	// sense-ai-app-dev hosting targets in .firebaserc. A built artefact is served to real
	// browsers, so it must never carry a bypass token however the flag is set.
	it.each(['localnet', 'testnet', 'mainnet', 'production'])(
		'REFUSES in a BUILD of mode %s, however the flag is set',
		(mode) => {
			expect(
				shouldUseAppCheckDebugToken({ dev: false, mode, debugFlag: 'true', token: 'tok' }),
			).toBe(false);
			expect(
				shouldUseAppCheckDebugToken({ dev: false, mode, debugFlag: true, token: 'tok' }),
			).toBe(false);
		},
	);

	// The dev server is the one thing that is never deployed, and DEV is set by Vite itself
	// rather than by an env file, so no .env can forge it.
	it('allows the dev server, which is never deployed', () => {
		expect(
			shouldUseAppCheckDebugToken({ dev: true, mode: 'localnet', debugFlag: undefined, token: 'tok' }),
		).toBe(true);
		expect(
			shouldUseAppCheckDebugToken({ dev: true, mode: 'testnet', debugFlag: '1', token: 'tok' }),
		).toBe(true);
	});

	it('honours an explicit opt-out even on the dev server', () => {
		expect(
			shouldUseAppCheckDebugToken({ dev: true, mode: 'localnet', debugFlag: 'false', token: 'tok' }),
		).toBe(false);
	});
});
