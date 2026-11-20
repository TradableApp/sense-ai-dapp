/** The local store cannot be named: the chain id or the agent address is missing or malformed. */
export class LocalStoreConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LocalStoreConfigError';
	}
}

const STORE_PREFIX = 'SenseAI';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_ID = /^[1-9][0-9]*$/;

/**
 * Name of the browser database for one agent contract on one chain.
 *
 * Conversation ids are counted by the agent contract, so every agent starts at 1. Rows are
 * keyed by wallet and conversation id; two agents in one database would share keys, and a
 * wallet that used both would see their conversations merged. The sync cursor is stored
 * beside them and would carry over too. One database per agent keeps all of it apart with
 * no change to the keys.
 *
 * A missing or malformed value throws: a name such as `SenseAI:84532:undefined` would be one
 * store shared by every agent, which is the fault this name exists to prevent.
 */
export function localStoreName(
	chainId: string | number | undefined,
	agentAddress: string | undefined,
): string {
	const chain = String(chainId ?? '');
	if (!CHAIN_ID.test(chain)) {
		throw new LocalStoreConfigError(`Local store needs a chain id, got "${chain}".`);
	}
	if (!agentAddress || !ADDRESS.test(agentAddress)) {
		throw new LocalStoreConfigError(
			`Local store needs the agent contract address, got "${agentAddress ?? ''}".`,
		);
	}
	return `${STORE_PREFIX}:${chain}:${agentAddress.toLowerCase()}`;
}

const LOCALNET_MODE = 'localnet';
/** The mode Vitest runs in. */
const UNIT_TEST_MODE = 'test';
const UNCONFIGURED_LOCALNET_STORE = `${STORE_PREFIX}:${LOCALNET_MODE}:unconfigured`;

const mayRunWithoutAgent = (mode: string | undefined): boolean =>
	mode === LOCALNET_MODE || mode === UNIT_TEST_MODE;

/**
 * The name the app opens its store under.
 *
 * Strict everywhere except a localnet build or a unit-test run with no agent address: the
 * browser tests that run against no contracts at all must still load the app, a unit test
 * that loads the store module unmocked should not fail on configuration, and neither has an
 * agent whose conversations could be mixed up. Its store has a name no agent's store can have.
 */
export function resolveLocalStoreName(
	chainId: string | number | undefined,
	agentAddress: string | undefined,
	mode: string | undefined,
): string {
	if (mayRunWithoutAgent(mode) && !agentAddress) return UNCONFIGURED_LOCALNET_STORE;
	return localStoreName(chainId, agentAddress);
}

/**
 * Stops a build or dev server whose chain id or agent address cannot name a store, in every
 * mode but the two `resolveLocalStoreName` lets run without an agent. Called from
 * `vite.config.ts`: the store module is in the first bundle, so the same fault found in the
 * browser would fail before error reporting or any page exists and leave a blank screen.
 */
export function assertLocalStoreConfig(
	mode: string,
	env: Record<string, string | undefined>,
): void {
	if (mayRunWithoutAgent(mode)) return;
	localStoreName(env.VITE_CHAIN_ID, env.VITE_AGENT_CONTRACT_ADDRESS);
}
