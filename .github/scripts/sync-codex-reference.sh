#!/usr/bin/env bash
# Syncs the upstream Codex source only when Codex is in the changed-tool list.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
ref_dir="$repo_root/references/codex"

if [ "${FORCE_CODEX_SYNC:-0}" = "1" ]; then
  old_revision="$(awk -F' = ' '$1 == "revision" { print $2; exit }' "$repo_root/codex/VERSION")"
  new_revision="$(git ls-remote https://github.com/openai/codex.git HEAD | cut -f1)"
  [ -n "$new_revision" ] || { echo "Could not resolve the current Codex revision." >&2; exit 1; }
else
  if [ ! -s "$changed_file" ]; then
    echo "No changed-tool state at $changed_file; skipping Codex source sync."
    exit 0
  fi

  jq -e 'type == "array"' "$changed_file" >/dev/null
  if ! jq -e 'any(.[]; .tool == "codex")' "$changed_file" >/dev/null; then
    echo "Codex is unchanged; skipping references/codex sync."
    exit 0
  fi

  new_revision="$(jq -er '.[] | select(.tool == "codex") | .new_version' "$changed_file")"
  old_revision="$(jq -er '.[] | select(.tool == "codex") | .old_version' "$changed_file")"
fi

if [ -d "$ref_dir/.git" ]; then
  git -C "$ref_dir" fetch --quiet --depth 1 --filter=blob:none origin "$new_revision"
  git -C "$ref_dir" reset --quiet --hard "$new_revision"
else
  mkdir -p "$repo_root/references"
  git init --quiet "$ref_dir"
  git -C "$ref_dir" remote add origin https://github.com/openai/codex.git
  git -C "$ref_dir" fetch --quiet --depth 1 --filter=blob:none origin "$new_revision"
  git -C "$ref_dir" checkout --quiet --detach "$new_revision"
fi

# Keep the prior captured revision available for source-level comparisons without
# retaining the upstream repository's complete history.
git -C "$ref_dir" fetch --quiet --depth 1 --filter=blob:none origin "$old_revision" || \
  echo "::warning::Could not fetch prior Codex revision $old_revision"

echo "references/codex is at $(git -C "$ref_dir" rev-parse HEAD)"
