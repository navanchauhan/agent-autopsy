#!/usr/bin/env bash
# Records bounded, source-authoritative evidence for Qwen Code. No live model
# request or interception is required because the complete implementation is public.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
tool_scratch="$scratch_root/qwen-code"
source_dir="$repo_root/references/qwen-code"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_root/changed-tools.json}"

old_revision="$(jq -er '.[] | select(.tool == "qwen-code") | .old_revision' "$changed_file")"
new_revision="$(jq -er '.[] | select(.tool == "qwen-code") | .new_revision' "$changed_file")"
[ "$(git -c safe.directory="$source_dir" -C "$source_dir" rev-parse HEAD)" = "$new_revision" ] || {
  echo "Qwen Code reference is not at the planned revision." >&2
  exit 1
}

mkdir -p "$tool_scratch"
jq -n --arg old "$old_revision" --arg new "$new_revision" \
  '{old_revision:$old,new_revision:$new,source:"QwenLM/qwen-code",capture_mode:"direct source extraction"}' \
  >"$tool_scratch/source-revisions.json"

{
  echo '# Full release diff summary'
  git -c safe.directory="$source_dir" -C "$source_dir" diff --shortstat "$old_revision" "$new_revision"
} >"$tool_scratch/source-changes.txt"

node "$repo_root/.github/scripts/source-surface-inventory.cjs" \
  qwen-code "$source_dir" "$old_revision" "$new_revision" \
  "$tool_scratch/source-surface-inventory.json" packages/core/src packages/cli/src

candidate_count="$(jq -r '.candidates | length' "$tool_scratch/source-surface-inventory.json")"
changed_candidate_count="$(jq -r '[.candidates[] | select(.changed)] | length' "$tool_scratch/source-surface-inventory.json")"
jq -n \
  --arg revision "$new_revision" \
  --argjson candidate_count "$candidate_count" \
  --argjson changed_candidate_count "$changed_candidate_count" \
  '{source_revision:$revision,surface_inventory:"source-surface-inventory.json",
    candidate_count:$candidate_count,changed_candidate_count:$changed_candidate_count,
    network_capture_required:false}' \
  >"$tool_scratch/direct-source-manifest.json"
