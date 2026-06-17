import { describe, expect, it } from 'vitest';

import needsSessionDerivation from './sessionDerivation';

const WALLET_A = '0xAAaAAAaAaAAAAaAAaAAAAAAaAaAAaAAaAaAaAaAa';
const WALLET_B = '0xBbBBbBbbBBbBbBBbBBbbBbBBbBbBBBBbbBBbBBbB';

describe('needsSessionDerivation', () => {
	it('does not derive when no account is connected', () => {
		expect(needsSessionDerivation(false, null, null)).toBe(false);
		expect(needsSessionDerivation(true, WALLET_A, undefined)).toBe(false);
	});

	it('derives when an account is connected but no key exists yet', () => {
		expect(needsSessionDerivation(false, null, WALLET_A)).toBe(true);
	});

	it('does not re-derive when the key already belongs to the connected account (tab refocus)', () => {
		expect(needsSessionDerivation(true, WALLET_A, WALLET_A)).toBe(false);
	});

	it("re-derives when the connected account differs from the key's account (wallet switch)", () => {
		// The bug T-MULTI-07 found: without this, the previous account's session key (and its
		// decrypted data) would persist under the new account.
		expect(needsSessionDerivation(true, WALLET_A, WALLET_B)).toBe(true);
	});
});
