/**
 * The fee token the build under test was made for, read from the same setting and the same
 * profile data the app uses (`VITE_FEE_TOKEN`, loaded from the per-mode env file by
 * `playwright.config.ts`). Specs and page objects ask this for the symbol and the transfer rule
 * and never name a token; the `fee-token-literals` guard holds them to that.
 *
 * `feeToken.ts` itself cannot be loaded here (it imports logos, ABIs and `import.meta.env`),
 * so this reads the part of the profile kept in `feeTokenConfig.ts` for code outside the bundle.
 */
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';

import { CHAIN, rpc } from './chain';
import {
	assertFeeTokenConfig,
	FEE_TOKEN_BASICS,
	feeTokenNameFor,
} from '../../src/config/feeTokenConfig';

export interface FeeTokenFacts {
	/** The symbol the app shows beside every amount. */
	symbol: string;
	/** Whether a holder can send it to another holder (false: only to or from listed addresses). */
	transferable: boolean;
}

/**
 * The profile's facts for this run. Stops, as the build does, when the setting is missing or
 * misspelt: a suite that guessed the token would assert the wrong symbol and the wrong rule.
 */
export function feeToken(env: Record<string, string | undefined> = process.env): FeeTokenFacts {
	assertFeeTokenConfig(CHAIN, env);
	return FEE_TOKEN_BASICS[feeTokenNameFor(env.VITE_FEE_TOKEN)];
}

/** The symbol as a whole word, for locators that match a displayed amount ("12.5 <symbol>"). */
export function feeTokenSymbolPattern(): RegExp {
	return new RegExp(`\\b${feeToken().symbol}\\b`);
}

const SYMBOL_ABI = parseAbi(['function symbol() view returns (string)']);

/** The symbol the token at `tokenAddress` reports, read through the chain adapter. */
async function readTokenSymbol(tokenAddress: string): Promise<string> {
	const data = encodeFunctionData({ abi: SYMBOL_ABI, functionName: 'symbol' });
	const result = (await rpc('eth_call', [{ to: tokenAddress, data }, 'latest'])) as `0x${string}`;
	return decodeFunctionResult({ abi: SYMBOL_ABI, functionName: 'symbol', data: result });
}

/**
 * Fails unless the token on chain is the one the setting names. A spec that decides from the
 * setting what to run (or skip) asks this first, on a live stack: on testnet the build under test
 * is a hosted one while the setting comes from the local env file, and a file that names the
 * other token would otherwise turn every test for this token into a skip and the run green.
 */
export async function assertChainTokenMatchesSetting(
	tokenAddress: string,
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const { symbol } = feeToken(env);
	const onChain = await readTokenSymbol(tokenAddress);
	if (onChain !== symbol) {
		throw new Error(
			`The fee token on chain reports the symbol ${onChain}, but VITE_FEE_TOKEN selects the ` +
				`${symbol} profile. The env file does not describe this deployment; fix it before ` +
				'reading any result that depends on the profile.',
		);
	}
}
