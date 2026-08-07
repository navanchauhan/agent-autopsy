#!/usr/bin/env bash

# Restore correctness-critical workflow state from a dedicated Git branch. The
# branch is intentionally separate from the default branch so polling can durably
# enqueue releases without creating user-facing commits.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${AUTOMATION_STATE_DIR:-$repo_root/.capture-scratch/automation-state}"
state_ref='refs/heads/automation/release-state'
tracking_ref='refs/remotes/origin/automation/release-state'

mkdir -p "$state_dir"

set +e
git -C "$repo_root" ls-remote --exit-code --heads origin "$state_ref" >/dev/null 2>&1
lookup_status=$?
set -e

if [ "$lookup_status" -eq 0 ]; then
  GIT_TERMINAL_PROMPT=0 git -C "$repo_root" fetch --quiet --no-tags --depth=1 origin \
    "+$state_ref:$tracking_ref"

  for entry in release-ledger.json recapture-state.json; do
    mode="$(git -C "$repo_root" ls-tree "$tracking_ref" -- "$entry" | awk '{ print $1 " " $2 }')"
    [ "$mode" = '100644 blob' ] || {
      echo "Automation state branch has an invalid $entry entry." >&2
      exit 1
    }
  done

  staged_entries=()
  cleanup_staged_entries() {
    if [ "${#staged_entries[@]}" -gt 0 ]; then
      rm -f -- "${staged_entries[@]}"
    fi
  }
  trap cleanup_staged_entries EXIT

  for entry in release-ledger.json recapture-state.json; do
    temp="$(mktemp "$state_dir/.${entry}.XXXXXX")"
    staged_entries+=("$temp")
    git -C "$repo_root" show "$tracking_ref:$entry" >"$temp"
    jq -e . "$temp" >/dev/null || {
      echo "Automation state branch has invalid JSON in $entry." >&2
      exit 1
    }
  done

  mv -f "${staged_entries[0]}" "$state_dir/release-ledger.json"
  mv -f "${staged_entries[1]}" "$state_dir/recapture-state.json"
  staged_entries=()
  trap - EXIT
elif [ "$lookup_status" -eq 2 ]; then
  printf '%s\n' \
    '{"schema_version":1,"queues":{"codex":[],"claude-code":[],"grok":[],"antigravity":[]}}' \
    >"$state_dir/release-ledger.json"
  printf '%s\n' '{"schema_version":1,"tools":{}}' >"$state_dir/recapture-state.json"
else
  echo 'Could not determine whether the durable automation-state branch exists.' >&2
  exit "$lookup_status"
fi
