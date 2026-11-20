// Kept free of imports: `vite.config.ts` loads this file before any alias or asset loader
// exists, so it cannot pull in the profiles' logos and ABIs.

/** The tokens a build can be for. `feeToken.ts` holds one profile per name. */
export const FEE_TOKEN_NAMES = ['SENSE', 'ABLE'] as const;
export type FeeTokenName = (typeof FEE_TOKEN_NAMES)[number];

/** The build does not say which token pays the fees, or names one that does not exist. */
export class FeeTokenConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FeeTokenConfigError';
	}
}

/** Modes that run on a developer's machine, where falling back to the default harms nobody. */
const MODES_WITH_FALLBACK = ['localnet', 'test'];

/**
 * Stops a build or dev server that does not name its fee token exactly. Called from
 * `vite.config.ts`. A missing name is allowed only where the fallback in `selectFeeToken`
 * is safe; a name that is present but unknown (a misspelling) is refused everywhere, since
 * it shows the fallback was not what was meant.
 */
export function assertFeeTokenConfig(mode: string, env: Record<string, string | undefined>): void {
	const value = env.VITE_FEE_TOKEN ?? '';
	if ((FEE_TOKEN_NAMES as readonly string[]).includes(value)) return;
	if (value === '' && MODES_WITH_FALLBACK.includes(mode)) return;
	throw new FeeTokenConfigError(
		`VITE_FEE_TOKEN must be one of ${FEE_TOKEN_NAMES.join(
			', ',
		)} for a ${mode} build, got "${value}".`,
	);
}

/**
 * The escrow's getter for the token it takes. The name is from the escrow's first deploy
 * and is kept by the contract whichever token it holds; it is spelled out here only.
 */
export const ESCROW_FEE_TOKEN_GETTER = 'ableToken';
