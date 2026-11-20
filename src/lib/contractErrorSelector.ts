import { keccak256, stringToBytes } from 'viem';

type AbiInput = { type: string; components?: readonly AbiInput[] };
type AbiEntry = { type?: string; name?: string; inputs?: readonly AbiInput[] };

// A struct parameter is written as its member types in brackets, keeping any array suffix.
function canonicalType(input: AbiInput): string {
	if (!input.type.startsWith('tuple')) return input.type;
	const members = (input.components ?? []).map(canonicalType).join(',');
	return `(${members})${input.type.slice('tuple'.length)}`;
}

/**
 * The four bytes a node returns as revert data for a custom error: the start of keccak256
 * of the error's canonical signature, which is its name and bare parameter types.
 *
 * Worked out here and not with viem's `toFunctionSelector`: given an error item, that
 * hashes the signature with the `error` keyword and the parameter names still in it, and
 * the result matches nothing a contract ever reverts with.
 */
export function errorSelector(abi: readonly unknown[], name: string): `0x${string}` | undefined {
	const item = (abi as readonly AbiEntry[]).find(
		entry => entry.type === 'error' && entry.name === name,
	);
	if (!item) return undefined;
	const signature = `${name}(${(item.inputs ?? []).map(canonicalType).join(',')})`;
	return keccak256(stringToBytes(signature)).slice(0, 10) as `0x${string}`;
}

/**
 * Whether an error message reports the named custom error, by its name or by its selector.
 *
 * Both are needed. A local node writes the name into the message. A public node returns
 * only the revert data, and the wallet library decodes that against the contract that was
 * called: an error raised by another contract inside the call (the token, inside an escrow
 * call) is not in that ABI, and the message then carries the selector and nothing else.
 */
export function messageNamesError(message: string, abi: readonly unknown[], name: string): boolean {
	const selector = errorSelector(abi, name);
	if (!selector) return false;
	return message.includes(name) || message.toLowerCase().includes(selector);
}
