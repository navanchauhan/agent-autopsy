#!/usr/bin/env bash

# Atomically persist the release FIFO and recapture state to the dedicated state
# branch. Callers must restore the branch first and must have contents:write.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${AUTOMATION_STATE_DIR:-$repo_root/.capture-scratch/automation-state}"
state_ref='refs/heads/automation/release-state'
tracking_ref='refs/remotes/origin/automation/release-state'
ledger="$state_dir/release-ledger.json"
recapture="$state_dir/recapture-state.json"

for file in "$ledger" "$recapture"; do
  [ -s "$file" ] || { echo "Missing durable automation state: $file" >&2; exit 1; }
  jq -e . "$file" >/dev/null
done

parent=''
if git -C "$repo_root" rev-parse --verify -q "$tracking_ref^{commit}" >/dev/null; then
  parent="$(git -C "$repo_root" rev-parse "$tracking_ref^{commit}")"
  old_ledger="$(mktemp "$state_dir/.old-ledger.XXXXXX")"
  old_recapture="$(mktemp "$state_dir/.old-recapture.XXXXXX")"
  trap 'rm -f -- "${old_ledger:-}" "${old_recapture:-}"' EXIT
  if git -C "$repo_root" show "$parent:release-ledger.json" >"$old_ledger" 2>/dev/null && \
     git -C "$repo_root" show "$parent:recapture-state.json" >"$old_recapture" 2>/dev/null && \
     cmp -s "$ledger" "$old_ledger" && cmp -s "$recapture" "$old_recapture"; then
    echo 'Durable automation state is already current.'
    exit 0
  fi
fi

ledger_blob="$(git -C "$repo_root" hash-object -w "$ledger")"
recapture_blob="$(git -C "$repo_root" hash-object -w "$recapture")"
tree="$({
  printf '100644 blob %s\trecapture-state.json\n' "$recapture_blob"
  printf '100644 blob %s\trelease-ledger.json\n' "$ledger_blob"
} | git -C "$repo_root" mktree)"

commit_args=( "$tree" )
if [ -n "$parent" ]; then commit_args+=( -p "$parent" ); fi
commit="$(
  printf 'Update durable agent-autopsy release state\n' |
    GIT_AUTHOR_NAME='github-actions[bot]' \
    GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
    GIT_COMMITTER_NAME='github-actions[bot]' \
    GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com' \
    git -C "$repo_root" commit-tree "${commit_args[@]}"
)"

GIT_TERMINAL_PROMPT=0 git -C "$repo_root" push --quiet origin "$commit:$state_ref"
git -C "$repo_root" update-ref "$tracking_ref" "$commit"
echo "Persisted durable automation state at $commit."
