// @vitest-environment node
//
// The build's own checks, run through the real Vite configuration. The text guards beside
// this one read `vite.config.ts` for the calls; this runs it, so a call that is still written
// but no longer reached (moved under a condition, given other arguments) fails here.
import type { ConfigEnv, UserConfigFnObject } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import viteConfig from '../../vite.config';

// A mode with no settings file of its own. The files Vite reads in every mode are still read,
// but a value in the process environment wins over a file, an empty one included, so the
// three settings stubbed below are the ones the configuration sees on any machine.
const MODE = 'build-check-fixture';
const AGENT = '0x00000000000000000000000000000000000000A1';

// No cast: a configuration that became an object, or asynchronous, stops type-checking here
// instead of turning every `not.toThrow` below into a test of nothing.
const configure: UserConfigFnObject = viteConfig;
const build = (overrides: Partial<ConfigEnv> = {}) =>
	configure({ mode: MODE, command: 'build', isPreview: false, ...overrides });

describe('build configuration checks', () => {
	beforeEach(() => {
		vi.stubEnv('VITE_CHAIN_ID', '84532');
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', AGENT);
		vi.stubEnv('VITE_FEE_TOKEN', 'SENSE');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('lets a build through when the store can be named and the fee token is set', () => {
		expect(() => build()).not.toThrow();
	});

	it('stops a build with no agent address', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');

		expect(() => build()).toThrow(/agent contract address/);
	});

	it('stops a build with no chain id', () => {
		vi.stubEnv('VITE_CHAIN_ID', '');

		expect(() => build()).toThrow(/chain id/);
	});

	it('stops a build that does not name its fee token', () => {
		vi.stubEnv('VITE_FEE_TOKEN', '');

		expect(() => build()).toThrow(/VITE_FEE_TOKEN/);
	});

	it('stops a dev server the same way', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');

		expect(() => build({ command: 'serve' })).toThrow(/agent contract address/);
	});

	it('stops a localnet build whose agent address is set but is not an address', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '0x1234');

		expect(() => build({ mode: 'localnet' })).toThrow(/agent contract address/);
	});

	it.each(['localnet', 'test'])(
		'lets a %s run through with no agent address and no fee token',
		mode => {
			vi.stubEnv('VITE_CHAIN_ID', '31337');
			vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');
			vi.stubEnv('VITE_FEE_TOKEN', '');

			expect(() => build({ mode })).not.toThrow();
			expect(() => build({ mode, command: 'serve' })).not.toThrow();
		},
	);

	it('checks when Vite does not say whether this is a preview', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');

		expect(() => configure({ mode: MODE, command: 'build' })).toThrow(/agent contract address/);
	});

	it('does not check a preview, which only serves a bundle that already passed', () => {
		vi.stubEnv('VITE_AGENT_CONTRACT_ADDRESS', '');
		vi.stubEnv('VITE_FEE_TOKEN', '');

		expect(() => build({ isPreview: true })).not.toThrow();
	});
});
