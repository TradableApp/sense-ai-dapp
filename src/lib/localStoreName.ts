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
