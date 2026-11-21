// Kept free of imports but this one, so `vite.config.ts` can load it without the profiles'
// logos and ABIs.
// Relative: Vite loads its config before the `@/` alias exists (an `@/` import fails there).
import describeShape from '../lib/settingShape';

/** The tokens a build can be for. `feeToken.ts` holds one profile per name. */
export const FEE_TOKEN_NAMES = ['SENSE', 'ABLE'] as const;
export type FeeTokenName = (typeof FEE_TOKEN_NAMES)[number];

/**
 * The part of each profile that code outside the browser bundle needs. The e2e suite runs in
 * Node and cannot load the profiles' logos and ABIs, so it reads these; `feeToken.ts` builds
 * each profile on them, so the two cannot disagree.
 */
export const FEE_TOKEN_BASICS = {
	SENSE: { symbol: 'SENSE', transferable: false },
	ABLE: { symbol: 'ABLE', transferable: true },
} as const satisfies Record<FeeTokenName, { symbol: string; transferable: boolean }>;

/**
 * The token a setting names, read the way the app reads it: trimmed, any letter case, and
 * anything but a known name is the first. That fallback is for the unit tests only;
 * `assertFeeTokenConfig` stops a build that relies on it.
 */
export function feeTokenNameFor(value: string | undefined): FeeTokenName {
	const name = (value ?? '').trim().toUpperCase();
	return FEE_TOKEN_NAMES.find(known => known === name) ?? FEE_TOKEN_NAMES[0];
}

/** The build does not say which token pays the fees, or names one that does not exist. */
export class FeeTokenConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FeeTokenConfigError';
	}
}

/**
 * The modes allowed to fall back to the default: only Vitest's. A localnet build or dev
 * server is set up by the e2e harness's sync, which always writes the setting, so one
 * without it is a mistake in setting up and stops like every other build.
 */
const MODES_WITH_FALLBACK = ['test'];

/**
 * Stops a build or dev server that does not name its fee token exactly. Called from
 * `vite.config.ts`. A missing name is allowed only in the unit-test mode, where the
 * fallback in `selectFeeToken` is safe; a name that is present but unknown (a misspelling) is refused everywhere, since
 * it shows the fallback was not what was meant.
 */
export function assertFeeTokenConfig(mode: string, env: Record<string, string | undefined>): void {
	const value = env.VITE_FEE_TOKEN ?? '';
	if ((FEE_TOKEN_NAMES as readonly string[]).includes(value)) return;
	if (value === '' && MODES_WITH_FALLBACK.includes(mode)) return;
	// Described by its shape, never printed: a key pasted into this setting would otherwise
	// land in a terminal or a CI log.
	throw new FeeTokenConfigError(
		`VITE_FEE_TOKEN must be one of ${FEE_TOKEN_NAMES.join(
			', ',
		)} for a ${mode} build; got ${describeShape(value)}.`,
	);
}

/**
 * The escrow's getter for the token it takes. The name is from the escrow's first deploy
 * and is kept by the contract whichever token it holds; it is spelled out here only.
 */
export const ESCROW_FEE_TOKEN_GETTER = 'ableToken';
