#!/usr/bin/env sh
# Copy the canonical contract ABIs out of the sibling repos, and record WHICH COMMIT they came from.
#
# The recording half is the point. Artifacts are gitignored build output in both contract repos, so
# there is no way to fetch a canonical ABI without compiling — which means a consumer cannot tell a
# current ABI from a stale one by looking at it. AbleToken and EVMAIAgentEscrow sat 12 days behind
# able-contracts#24 and tokenized-ai-agent#86 with a green suite the whole time, because nothing
# recorded where they came from.
#
# SOURCE.json is that record: the same pin-the-upstream-commit pattern this org already uses for the
# Brain (EXPECTED_BRAIN_SHA). It does not prevent drift; it makes drift answerable in one look.
set -eu

# Anchor to the repo root, because every path below is relative — the siblings via `..`, the
# destination via `./src`. This makes the script independent of the caller's directory: `$0`
# carries whatever path was used to reach it, so `dirname "$0"/..` resolves to the repo root for
# a relative, absolute or subdirectory invocation alike.
#
# The one form it cannot fix is `sh < scripts/sync-contracts.sh`. Redirected input leaves `$0` as
# the shell's own name, `dirname` yields `.`, and the cd lands one above the caller's directory.
# Invoke it by path (or via `bun run sync-contracts`), not on stdin.
cd "$(dirname "$0")/.." || exit 1

R="${REPOS_ROOT:-..}"
ABI_DIR="./src/lib/abi"

AGENT_SRC="$R/tokenized-ai-agent/artifacts/contracts/EVMAIAgent.sol/EVMAIAgent.json"
ESCROW_SRC="$R/tokenized-ai-agent/artifacts/contracts/EVMAIAgentEscrow.sol/EVMAIAgentEscrow.json"
ABLE_SRC="$R/able-contracts/artifacts/contracts/AbleToken.sol/AbleToken.json"

# VALIDATE EVERYTHING BEFORE WRITING ANYTHING.
#
# The copy loop used to run first and fingerprinting after it. Anything failing in between — `bun`
# absent from PATH, an artifact that would not parse — left NEW ABI bytes on disk beside a
# SOURCE.json still describing the OLD ones. The manifest would then be confidently wrong, and the
# test fires "does not match its recorded fingerprint — re-run bun run sync-contracts", sending
# whoever hit it back into the script that just failed rather than at the actual cause.
#
# So the order is: prove bun runs, prove every artifact exists and parses, take the fingerprints,
# and only then touch the destination.
command -v bun > /dev/null 2>&1 || {
  echo "error: bun is required to fingerprint the ABIs — see https://bun.sh" >&2
  exit 1
}

for src in "$AGENT_SRC" "$ESCROW_SRC" "$ABLE_SRC"; do
  if [ ! -f "$src" ]; then
    echo "error: canonical artifact missing: $src" >&2
    echo "       compile the sibling repo first (its artifacts/ is gitignored build output)." >&2
    exit 1
  fi
done

# The sibling's checkout AT SYNC TIME — not proof the artifacts were compiled from it, since this
# script copies `artifacts/` rather than rebuilding it. abiSha256 still pins WHICH interface is
# committed; only the provenance is soft. Compiling the siblings here would make the pairing true
# by construction, and is left as a follow-up.
ABLE_SHA=$(git -C "$R/able-contracts" rev-parse HEAD)
TA_SHA=$(git -C "$R/tokenized-ai-agent" rev-parse HEAD)

# Warn when the compiled artifacts cannot be honestly attributed to the recorded commit.
#
# Only the dirty-tree case is checkable here. A dirty tree means the ABI may include uncommitted
# work that no SHA describes, which makes the manifest's commit field wrong in a way the reader
# cannot detect.
#
# There used to be an origin/main ancestry check beside this. It was removed because it was
# silent in exactly the case this script exists for: `merge-base --is-ancestor HEAD origin/main`
# passes for ANY merged commit, including one from a year ago, so artifacts compiled from a long
# stale checkout produced no warning at all while a feature branch produced a loud one. A check
# that fires on the harmless case and stays quiet on the harmful one trains people to ignore it.
# It also fetched from the network on every run, swallowing failures, which made its own result
# untrustworthy offline.
for repo in able-contracts tokenized-ai-agent; do
  if [ -n "$(git -C "$R/$repo" status --porcelain --untracked-files=no)" ]; then
    echo "warning: $repo has uncommitted changes — the recorded commit may not describe these ABIs." >&2
  fi
done

# Fingerprint the INTERFACE each ABI exposes, so the manifest attests the files it names rather
# than merely sitting beside them. Without it, `cp`ing a freshly-compiled ABI into place and
# committing leaves the recorded commit describing something else entirely, with a green suite.
# Hashing the parsed `abi` rather than the bytes keeps `prettier --write` from reddening the test
# over whitespace nobody depends on.
fingerprint() {
  _fp=$(bun scripts/abi-fingerprint.mjs "$1")
  # Reject an empty result rather than writing it. abi-fingerprint.mjs decides it is being run
  # as a CLI by checking its own filename, so a renamed or symlinked copy exits 0 having printed
  # nothing — and "abiSha256": "" would sail into SOURCE.json. The test would catch it a step
  # later with "does not match its recorded fingerprint", pointing at the ABI rather than at the
  # script that produced no hash.
  if [ -z "$_fp" ]; then
    echo "error: fingerprint of $1 came back empty — is scripts/abi-fingerprint.mjs intact?" >&2
    exit 1
  fi
  printf '%s\n' "$_fp"
}

# Fingerprint the SOURCE artifacts, not the copies. `cp` is a byte copy so the values are
# identical either way, but reading the source means a malformed artifact aborts here, with the
# destination still untouched. Under `set -e` a failing fingerprint ends the script.
ABLE_FP=$(fingerprint "$ABLE_SRC")
AGENT_FP=$(fingerprint "$AGENT_SRC")
ESCROW_FP=$(fingerprint "$ESCROW_SRC")

# Past this line the destination changes.
cp "$AGENT_SRC" "$ESCROW_SRC" "$ABLE_SRC" "$ABI_DIR/"

cat > "$ABI_DIR/SOURCE.json" <<JSON
{
  "_comment": [
    "Which upstream commit each committed ABI was generated from. Regenerated by \`bun run sync-contracts\`.",
    "This is the EXPECTED_BRAIN_SHA pattern applied to ABIs: the pin makes staleness INSPECTABLE.",
    "Before this file existed, the only way to notice drift was to diff against a local build —",
    "which is why AbleToken and EVMAIAgentEscrow sat 12 days stale behind able-contracts#24 and",
    "tokenized-ai-agent#86 with a green suite the whole time.",
    "To check for drift: compare these SHAs against the default branch of each repo.",
    "The commit is the sibling's checkout when sync ran; it does not prove the ABI was compiled",
    "from it, since artifacts/ is copied rather than rebuilt. abiSha256 below is computed from the",
    "abi array (see below) and is exact — so a surprising commit means recompile and re-sync.",
    "abiSha256 is sha256 of JSON.stringify(artifact.abi) — the interface, not the file, so",
    "reformatting does not break it. abi-sync.test.ts recomputes and compares it, which is what",
    "stops an ABI arriving by any route other than this script."
  ],
  "sources": {
    "AbleToken.json":        { "repo": "TradableApp/able-contracts",     "commit": "$ABLE_SHA", "abiSha256": "$ABLE_FP" },
    "EVMAIAgent.json":       { "repo": "TradableApp/tokenized-ai-agent", "commit": "$TA_SHA", "abiSha256": "$AGENT_FP" },
    "EVMAIAgentEscrow.json": { "repo": "TradableApp/tokenized-ai-agent", "commit": "$TA_SHA", "abiSha256": "$ESCROW_FP" }
  }
}
JSON

printf 'ABIs synced. able-contracts=%.7s tokenized-ai-agent=%.7s\n' "$ABLE_SHA" "$TA_SHA"
