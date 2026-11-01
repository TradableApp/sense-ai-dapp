// @vitest-environment node
//
// Static guard over the build/deploy package scripts and .firebaserc (pure Node; see the
// adr-0002 guard for why the environment is pinned per file).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Deploy-target rules. On 2026-10-15 a testnet bundle was deployed to the production hosting
 * site because the hand-off command named `--project tradable-app` by hand, and the bare
 * `build` script was mainnet mode by default, so the hazard was one forgotten suffix away.
 * These rules keep every path to production explicit:
 *
 * 1. A bare `bun run build` must not produce a mainnet bundle — it fails and names the modes.
 * 2. Every script that runs `firebase deploy` names its `--project` alias; `firebase use`
 *    state on the operator's machine never decides where a bundle lands.
 * 3. `deploy:testnet` builds testnet and deploys to the `local` alias (tradable-app-garrick).
 * 4. `deploy:mainnet` builds mainnet, deploys to the `prod` alias (tradable-app), and runs
 *    the confirm guard first — which refuses unless DEPLOY_MAINNET_CONFIRMED=1 is exported.
 * 5. The aliases themselves keep pointing at the right projects.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
};
const firebaserc = JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')) as {
	projects: Record<string, string>;
};

const { scripts } = pkg;
const GUARD_SCRIPT = 'scripts/deploy-guard.ts';
const CONFIRM_VAR = 'DEPLOY_MAINNET_CONFIRMED';

// The confirm variable is removed from the inherited environment (not set to ''), so a call
// with no override really exercises the unset branch and an empty string is its own case.
const { [CONFIRM_VAR]: _inherited, ...baseEnv } = process.env;

const runGuard = (extraEnv: Record<string, string>) =>
	spawnSync('bun', [GUARD_SCRIPT], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...baseEnv, ...extraEnv },
	});

describe('build scripts', () => {
	it('bare `build` does not build a mainnet bundle', () => {
		expect(scripts.build).toBeDefined();
		expect(scripts.build).not.toContain('--mode mainnet');
		expect(scripts.build).not.toContain('vite build');
	});

	it('bare `build` exits non-zero and names the explicit modes', () => {
		const result = spawnSync('bun', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
		const output = `${result.stdout}${result.stderr}`;

		expect(result.status).not.toBe(0);
		expect(output).toContain('build:testnet');
		expect(output).toContain('build:mainnet');
	});

	it('keeps one explicit build script per mode', () => {
		expect(scripts['build:localnet']).toBe('vite build --mode localnet');
		expect(scripts['build:testnet']).toBe('vite build --mode testnet');
		expect(scripts['build:mainnet']).toBe('vite build --mode mainnet');
	});
});

describe('deploy scripts', () => {
	const deployScripts = Object.entries(scripts).filter(([, cmd]) =>
		cmd.includes('firebase deploy'),
	);

	it('every firebase deploy names its --project alias', () => {
		expect(deployScripts.length).toBeGreaterThan(0);
		deployScripts.forEach(([name, cmd]) => {
			expect(cmd, `${name} relies on \`firebase use\` state`).toMatch(/--project (local|prod)\b/);
			expect(cmd, `${name} must target the sense-ai hosting site only`).toContain(
				'--only hosting:sense-ai',
			);
		});
	});

	it('deploy:testnet builds testnet and deploys to the local alias', () => {
		const cmd = scripts['deploy:testnet'];

		expect(cmd).toContain('bun run build:testnet');
		expect(cmd).toContain('--project local');
		expect(cmd).not.toContain('prod');
	});

	it('deploy:mainnet runs the confirm guard, then builds mainnet, then deploys to prod', () => {
		const cmd = scripts['deploy:mainnet'];
		const guardAt = cmd.indexOf(GUARD_SCRIPT);
		const buildAt = cmd.indexOf('bun run build:mainnet');
		const deployAt = cmd.indexOf('firebase deploy');

		expect(guardAt).toBeGreaterThanOrEqual(0);
		expect(buildAt).toBeGreaterThan(guardAt);
		expect(deployAt).toBeGreaterThan(buildAt);
		expect(cmd).toContain('--project prod');
		expect(cmd.split('&&')).toHaveLength(3);
	});
});

describe('mainnet confirm guard', () => {
	it(`refuses when ${CONFIRM_VAR} is unset and says how to confirm`, () => {
		const result = runGuard({});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`${CONFIRM_VAR} is unset`);
		expect(result.stderr).toContain(`${CONFIRM_VAR}=1`);
		expect(result.stderr).toContain('tradable-app');
	});

	it('refuses an empty string and truthy-looking values other than exactly "1"', () => {
		['', 'true', 'yes', 'TRUE', ' 1'].forEach(value => {
			const result = runGuard({ [CONFIRM_VAR]: value });

			expect(result.status, `value ${JSON.stringify(value)}`).toBe(1);
			expect(result.stderr).toContain(`${CONFIRM_VAR} is ${JSON.stringify(value)}`);
		});
	});

	it(`passes when ${CONFIRM_VAR}=1 and says so on stdout`, () => {
		const result = runGuard({ [CONFIRM_VAR]: '1' });

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(`${CONFIRM_VAR}=1`);
		expect(result.stdout).toContain('tradable-app');
		expect(result.stderr).toBe('');
	});
});

describe('.firebaserc aliases', () => {
	it('local is the garrick project and prod is production', () => {
		expect(firebaserc.projects.local).toBe('tradable-app-garrick');
		expect(firebaserc.projects.prod).toBe('tradable-app');
	});
});
