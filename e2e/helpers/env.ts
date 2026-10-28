/**
 * Loads the dApp's per-mode env file for Node-side e2e code, so helpers see the same contract
 * addresses and Graph URL the dApp build used. `playwright.config.ts` and the testnet scripts
 * both call this; it never overrides a variable the caller's environment already set (the
 * run-day runner exports its own values and they must win).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { type ChainName, resolveChain } from './chain';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function envFileFor(chain: ChainName): string {
	return path.join(ROOT, chain === 'testnet' ? '.env.testnet' : '.env.localnet');
}

/** Returns the file that was loaded, for log lines. */
export function loadChainEnv(): string {
	const file = envFileFor(resolveChain(process.env));
	dotenv.config({ path: file, quiet: true });
	return file;
}
