# 7. Oracle keys come from the ROFL key service, and the oracle publishes its own encryption key

**Status:** Accepted, partly implemented. Built: the agent contract's oracle-only
`setOracleEncryptionKey(key, proof)`, the publisher slot, and the withdrawal of the key when its
publisher loses the oracle role; the subgraph indexing of both. Not built yet: the oracle taking
its keys from the key service and publishing, the ROFL manifests without a key secret, the dApp
reading the key from chain, and the migration of Base Sepolia.
**Applies to:** system-wide (`tokenized-ai-agent` contracts and oracle, `sense-ai-subgraph`,
`sense-ai-dapp`, `sense-ai-e2e`).
**Date:** 2026-11-14
**Refines:** [ADR-0006](0006-oracle-authorization-and-rotation.md) (how the shared key is
published) and [ADR-0005](0005-realtime-cross-device-sync-and-multi-tee.md) (the shared
decryption identity).

## Context

On Base the oracle decrypts each prompt's session key with a private key. That key has been a
ROFL secret set by the operator, so it existed outside the TEE, and the same key also signed the
oracle's transactions. ADR-0006 put the matching public key on the agent contract and let the
owner set it, which means the owner could publish a key no oracle holds: users would pay for
prompts that are refunded an hour later.

A ROFL app can ask its key service (`appd`) for a key by name. The key is derived from the app's
identity and the name, not from the machine or the image, so it is the same after a restart, a
redeploy with wiped storage, on another machine, and on every replica of the app. It never
leaves the TEE.

## Decision

1. **Keys.** On every network except localnet the oracle takes two keys from the key service:
   one to sign transactions and one to decrypt session keys. Their names include the chain id and
   the agent address, and a version that is raised to rotate. There is no fallback to an
   environment key: if the key service does not answer, the oracle waits and alerts. Localnet
   keeps the environment key, because there is no TEE there.
2. **The oracle publishes its encryption key.** `setOracleEncryptionKey(key, proof)` is
   oracle-only. The proof is a signature by the key over the chain id, the agent, the sender and
   the key, so only a key whose holder signed for an oracle can be published. The owner no longer
   sets the key.
3. **One key slot, held by its publisher.** A key can be published when the slot is empty, or
   replaced by the oracle that published it. Another oracle cannot replace it. Publishing the key
   already there changes nothing, so replicas that hold the same key can each try at start-up.
4. **The key leaves with its publisher.** When the publisher loses the oracle role, the key is
   withdrawn and the event says so with a zero publisher and no bytes.
5. **Clients treat "no key" as "do not submit".** The dApp will read the key from chain and
   refuse to send a prompt while there is none, instead of taking a paid prompt nobody can read.
6. **Scaling is by replicas of one ROFL app.** Replicas share the decryption key, so any of them
   can read any prompt and, through the session key every request carries, the whole
   conversation. A second ROFL app would derive a different key and is not supported by the
   single key slot.

## Consequences

- **Positive:** no operator handles the decryption key; a wrong or stale key cannot be published;
  removing a compromised oracle stops clients using its key at once; a key change reaches every
  client without a rebuild once the dApp reads the chain.
- **The proof shows who holds the key, not where it was made.** Base has no on-chain attestation,
  so which addresses are oracles remains the owner's decision. The event names the publisher, so
  every publication can be checked against the oracle's known address.
- **A key change has a pause.** Replacing the publisher means removing it first, so there is a
  short time with no key, during which clients refuse to submit.
- **Removing the publisher clears the key for every replica** until another publishes. With one
  oracle on Base this does not arise; a design with several signers must hand the slot over.
- **Still trusted:** the ROFL app's admin account (it can authorise a new image, which can derive
  the keys; the change is visible on Sapphire), the image registry until images are pinned by
  digest, the Oasis key manager, and the TEE hardware.
- **Base Sepolia is migrated; mainnet starts this way.** Mainnet deploys fresh, with keys from
  the key service from the first block.
- **Not yet measured:** that two replicas running at once derive the same key. It follows from
  the Oasis documentation and source, and is checked on a machine before the migration.
- **Alternatives rejected:** the owner sets the key (can publish a key nobody holds, and handles
  nothing useful); last writer wins on the slot (two oracles with different keys repoint clients
  on every restart); one key for signing and decrypting (a leak on the signing path would expose
  every prompt); a key per oracle (ADR-0006, Option A); an environment-key fallback on a public
  network (a broken mount would quietly bring back an operator-held key).
