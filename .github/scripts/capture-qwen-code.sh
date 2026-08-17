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
  echo
  echo '# Model-facing source paths'
  git -c safe.directory="$source_dir" -C "$source_dir" ls-tree -r --name-only "$new_revision" -- packages/core/src packages/cli/src \
    | grep -Ei '(^|/)(prompt|prompts|tool|tools|agent|agents|memory|hook|review|instruction|message|policy|permission)' \
    | awk 'NR <= 400'
} >"$tool_scratch/source-changes.txt"

jq -n \
  --arg revision "$new_revision" \
  --arg core_prompt 'packages/core/src/core/prompts.ts' \
  --arg prompt_registry 'packages/core/src/prompts/prompt-registry.ts' \
  --arg tool_registry 'packages/core/src/tools/tool-registry.ts' \
  '{source_revision:$revision,authoritative_entrypoints:{core_prompt:$core_prompt,prompt_registry:$prompt_registry,tool_registry:$tool_registry},network_capture_required:false}' \
  >"$tool_scratch/direct-source-manifest.json"
