# 9. The history key comes from one EIP-4361 message bound to the wallet, the site and the chain

**Status:** Accepted
**Applies to:** `sense-ai-dapp` (the session message, the session key and where it is asked for)
**Date:** 2026-11-27

## Context

Every conversation and message is encrypted on the device with a session key, and the same key
is wrapped for the oracle with each paid request. The key is not stored: it is derived again on
each visit from the user's wallet signature over a message, so the signature is the key's
secret. Until now the message was one fixed sentence that named no site and no chain. A wallet
showed it as plain text and could not tell the user which site was asking, and the same
signature gave the same key on any network.

The requirements were: a wallet that reads structured sign-in messages can compare the site
named with the page asking and warn when they differ; the text says what the signature is for;
one wallet gets the same key on every visit and device for one site and chain; a different
network gives a different key; replacing the agent contracts changes no user's key; and a
wallet that cannot give the same signature twice is refused before any history is written with
a key that cannot be made again.

## Decision

1. **One message, built in one module.** `buildSessionMessage`
   (`src/features/auth/sessionMessage.ts`) builds a strict EIP-4361 (Sign-In with Ethereum)
   message with viem's `createSiweMessage`, and viem's `parseSiweMessage` reads it back to
   exactly the fields it was built from: the site's host as the domain (an `http` site also
   names its scheme), the checksummed account, a one-line statement saying the signature creates
   the key that encrypts the history and never to sign it on any other site, the site as URI,
   `Version: 1`, the build's chain id, a fixed nonce and a fixed `Issued At`, and no expiration,
   not-before time, request id or resources.
2. **The nonce and the time are constants on purpose.** The signature is the key's secret, not a
   login. The text is byte for byte the same on every visit and device for one wallet, site and
   chain, so the key is too. Replay protection is not a property of this message, and nothing
   accepts it as a sign-in.
3. **Bound to the wallet, the site and the chain, and to nothing else.** The message names no
   agent contract, so a new contract pair changes no key; which deployment a stored row belongs
   to is the local store's per-agent database.
4. **One site per network, by build mode** (`sessionSiteFor`): `mainnet` names
   `https://senseai.tradable.app`, `testnet` the sandbox site, and `localnet` and the unit tests
   `http://localhost:3002`. It is never the page's own host. A mode with no site, a malformed
   chain id or a malformed wallet address throws `SessionMessageConfigError` before anything is
   signed, and every mode a package script builds or serves must have a site.
5. **Where it is asked for** (`isSessionOriginAllowed`, `src/features/auth/sessionOrigin.ts`). A
   `mainnet` build asks only when the page's origin is the site the message names; on any other
   host that serves the build the status is `wrong-site`, nothing is asked and the screen links
   to the site. `testnet`, `localnet` and `test` builds also ask on this machine (`localhost`,
   `127.0.0.1`, `[::1]`), where dev servers and the e2e runs serve them.
6. **The key** (`deriveSessionKey`, `src/features/auth/sessionKey.ts`). The signature is first
   brought to one form (lower-case hex, 65 bytes, the low `s`, `v` 27 or 28), so equivalent
   encodings of one signature give one key. HKDF takes the checksummed account as salt and an
   info string that names the message version.
7. **Plain 65-byte ECDSA only.** A signature that is not one (a smart account's ERC-1271 or
   ERC-6492 signature, a passkey's), or that does not recover to the connected account, throws
   `SessionSignatureError`: no key is made, the status is `unsupported-wallet`, and the screen
   asks the user to connect another wallet. Coinbase Wallet is offered with `eoaOnly`, so its
   smart account is never offered (`src/config/thirdweb.ts`).
8. **A key check value** (`src/lib/sessionKeyCheck.ts`). On first use of a local store with a
   key, one known value is encrypted under it and kept, never replaced. A later session that
   cannot read it shows a notice that history on this device was saved with a key from another
   signature; nothing is deleted and nothing is blocked. Rows that cannot be decrypted are left
   as they are and not shown.
9. **Changing the text is a version change.** Any change to the text, the site included, changes
   every user's key, and history stored under the old key can no longer be read. A deliberate
   change raises `SESSION_MESSAGE_VERSION`, which the nonce and the HKDF info both carry.

The `session-message-single-source` guard keeps the wording in the module, signing only in
`SessionProvider`, and the key made only through `deriveSessionKey`.

## Consequences

- **Positive:** a wallet that checks EIP-4361 domains shows the site and warns on any other page;
  the user reads what the signature is for; the same wallet gets the same key everywhere the
  site is served for that chain; testnet and mainnet keys differ; a contract pair can be
  replaced without touching anyone's history key; a wallet that cannot give a stable key is
  refused before it writes anything.
- **Negative:** moving the mainnet site to another domain changes every user's key, and needs a
  new version and a plan for the history stored under the old one. Smart-contract and passkey
  wallets cannot use the dApp. `bun run dev:testnet` on localhost asks for text that names the
  testnet site, and a wallet that checks domains warns there, as it should. History stored
  under an earlier message version is not readable with the new key.
- **Not guaranteed by this decision:** an in-app wallet (email, social or passkey login) signs
  with no prompt, so its user never sees the text and no wallet compares a domain. For those
  wallets the protection is the wallet provider's restriction of the client id to the app's
  domains, which is account configuration and not code. The signature screen asks the user to
  check the message only if the wallet shows one.
- **Alternatives rejected:**
  - _Keep the fixed sentence:_ no wallet can name the site asking, and one key serves every
    network.
  - _A fresh nonce and time on each visit (a real sign-in):_ the key would change on every
    visit, and the history saved under the last one could not be read.
  - _The page's own host as the domain:_ every host that serves the build (hosting defaults,
    previews) would give a different key for the same wallet.
  - _Name the agent contract in the message:_ replacing the contract pair would change every
    user's key.
  - _Accept smart-account and passkey signatures:_ they can differ from one signing to the next,
    so the key could not be made again.
