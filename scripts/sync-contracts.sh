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

# Anchor to the repo root before resolving anything. Every path below is relative — the sibling
# repos via `..`, the destination via `./src` — so invoking this as `sh scripts/sync-contracts.sh`
# from anywhere but the root would look for the siblings in the wrong place and copy to the wrong
# place. `bun run sync-contracts` happens to set the CWD for us; nothing else does.
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

ABLE_SHA=$(git -C "$R/able-contracts" rev-parse HEAD)
TA_SHA=$(git -C "$R/tokenized-ai-agent" rev-parse HEAD)

# Warn rather than fail on a source tree that cannot be cited.
#
# SOURCE.json tells its reader to "compare these SHAs against the default branch of each repo",
# so a SHA that is NOT on the default branch silently breaks the one thing the manifest is for.
# Both cases below produce exactly that:
#
#   dirty tree    - the compiled ABI includes uncommitted work no SHA describes;
#   feature branch - the SHA is real but unreachable from the default branch, and may never land.
#
# The second is easy to hit without noticing: sibling repos sit checked out on whatever branch
# their last task left them on. Warn rather than fail — the ABI bytes are still whatever was
# compiled, and refusing to sync would be worse than syncing with a caveat.
for repo in able-contracts tokenized-ai-agent; do
  if [ -n "$(git -C "$R/$repo" status --porcelain)" ]; then
    echo "warning: $repo has uncommitted changes — the recorded commit may not describe these ABIs." >&2
  fi
  # Refresh first: the ancestry test below compares against origin/main, a LOCAL remote-tracking
  # ref that reflects the last fetch rather than the remote. On a repo nobody has fetched lately
  # that makes the warning unreliable in both directions — silent when HEAD really is off-branch,
  # noisy when it has since landed. Best-effort, because being offline must not fail a sync that
  # otherwise needs no network.
  git -C "$R/$repo" fetch --quiet origin 2>/dev/null || true
  _default=$(git -C "$R/$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
  if [ -z "$_default" ]; then
    # A clone without a remote HEAD is common, and assuming origin/main silently would make the
    # ancestry warning permanently WRONG on any repo whose default is not main — a warning that
    # always fires is one people learn to scroll past, which costs us the time it does matter.
    echo "note: $repo has no remote HEAD set; assuming origin/main for the branch check." >&2
    echo "      Run: git -C $R/$repo remote set-head origin -a" >&2
    _default="origin/main"
  fi
  if ! git -C "$R/$repo" merge-base --is-ancestor HEAD "$_default" 2>/dev/null; then
    echo "warning: $repo HEAD is not on $_default — SOURCE.json would record a commit that cannot be" >&2
    echo "         found on the default branch, which is how the manifest is meant to be checked." >&2
  fi
done

# Fingerprint the INTERFACE each ABI exposes, so the manifest attests the files it names rather
# than merely sitting beside them. Without it, `cp`ing a freshly-compiled ABI into place and
# committing leaves the recorded commit describing something else entirely, with a green suite.
# Hashing the parsed `abi` rather than the bytes keeps `prettier --write` from reddening the test
# over whitespace nobody depends on.
fingerprint() {
  bun scripts/abi-fingerprint.mjs "$1"
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
