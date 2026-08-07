#!/usr/bin/env bash
# Produce a deterministic fingerprint of every tracked and untracked candidate
# byte under the exact tool directories named by a trusted capture plan.

set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
plan_file="${1:-${CHANGED_TOOLS_FILE:-$repo_root/.capture-scratch/ready-tools.json}}"

[ -s "$plan_file" ] || { echo "Candidate plan is missing: $plan_file" >&2; exit 2; }
jq -e 'type == "array" and length > 0' "$plan_file" >/dev/null

dirs=()
while IFS= read -r dir; do
  case "$dir" in
    codex|claude-code|grok|antigravity) ;;
    *) echo "Unsupported candidate directory: $dir" >&2; exit 2 ;;
  esac
  dirs+=("$dir")
done < <(jq -r '.[].dir' "$plan_file")

[ "${#dirs[@]}" -gt 0 ] || { echo "Candidate plan contains no directories" >&2; exit 2; }

{
  git -C "$repo_root" diff --binary --full-index --no-ext-diff --no-renames HEAD -- "${dirs[@]}"
  while IFS= read -r -d '' relative; do
    absolute="$repo_root/$relative"
    if [ -L "$absolute" ] || [ ! -f "$absolute" ]; then
      echo "Unsupported untracked candidate node: $relative" >&2
      exit 2
    fi
    printf 'untracked\0%s\0' "$relative"
    sha256sum -- "$absolute" | cut -d' ' -f1
  done < <(git -C "$repo_root" ls-files --others --exclude-standard -z -- "${dirs[@]}" | sort -z)
} | sha256sum | cut -d' ' -f1
