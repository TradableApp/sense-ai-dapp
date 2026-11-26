// The patterns the session-message guard scans src/ for, kept apart so each can be tested
// against code it must catch and code it must leave alone. Every pattern is matched against
// code with comments removed and all whitespace removed (so `import * as m` reads
// `import*asm`): no pattern relies on a word boundary that the flattening would remove.
export const SIGNING_RULES = {
	/** A message signer: thirdweb's and viem's `signMessage` (and hooks named after it), or the
	 *  EIP-1193 methods that sign a message or its hash. Typed-data methods are not matched. */
	signer: /signMessage|personal_sign|eth_sign(?![A-Za-z0-9_])/,
	/** The builder, by name: an import, an alias or a call. */
	builderNamed: /buildSessionMessage/,
	/** The message module taken whole, where the builder could be reached by another name. */
	moduleImportedWhole:
		/import\*as\w+from['"][^'"]*\/sessionMessage['"]|import\(['"][^'"]*\/sessionMessage['"]\)/,
	/** EIP-191 hashing of a text: with `eth_sign` it gives the same signature as personal_sign. */
	hashMessage: /hashMessage/,
	/** An EIP-1193 request whose method is not a plain string literal (a variable, a template,
	 *  a shorthand property). */
	computedRequestMethod: /\.request\(\{(?:[^{}]*,)?method(?::(?!(['"])[A-Za-z0-9_]+\1[,}])|[,}])/,
	/** An RPC method name put together from parts. */
	concatenatedRpcName:
		/(['"`])(?:personal|eth|wallet)_[A-Za-z0-9_]*\1\+|`[^`]*(?:personal|eth|wallet)_\$\{/,
} as const;
