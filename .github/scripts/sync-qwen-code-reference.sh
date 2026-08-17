#!/usr/bin/env bash
# Syncs the exact tagged Qwen Code source revision selected by the capture plan.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
ref_dir="$repo_root/references/qwen-code"

if [ ! -s "$changed_file" ] || ! jq -e 'any(.[]; .tool == "qwen-code")' "$changed_file" >/dev/null; then
  echo "Qwen Code is unchanged; skipping references/qwen-code sync."
  exit 0
fi

new_revision="$(jq -er '.[] | select(.tool == "qwen-code") | .new_revision' "$changed_file")"
old_revision="$(jq -er '.[] | select(.tool == "qwen-code") | .old_revision' "$changed_file")"

if [ -d "$ref_dir/.git" ]; then
  git -C "$ref_dir" remote set-url origin https://github.com/QwenLM/qwen-code.git
else
  mkdir -p "$repo_root/references"
  git init --quiet "$ref_dir"
  git -C "$ref_dir" remote add origin https://github.com/QwenLM/qwen-code.git
fi

for revision in "$new_revision" "$old_revision"; do
  if ! git -C "$ref_dir" cat-file -e "${revision}^{commit}" 2>/dev/null; then
    timeout 5m git -C "$ref_dir" -c core.hooksPath=/dev/null fetch --quiet --depth 1 origin "$revision"
  fi
done

git -C "$ref_dir" -c core.hooksPath=/dev/null checkout --quiet --detach --force "$new_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null reset --quiet --hard "$new_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null clean --quiet -ffdx

timeout 10m git -C "$ref_dir" diff --binary --no-ext-diff "$old_revision" "$new_revision" -- >/dev/null
GIT_NO_LAZY_FETCH=1 timeout 10m git -C "$ref_dir" diff --binary --no-ext-diff \
  "$old_revision" "$new_revision" -- >/dev/null

echo "references/qwen-code is at $(git -C "$ref_dir" rev-parse HEAD)"
