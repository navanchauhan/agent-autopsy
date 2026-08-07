#!/usr/bin/env bash
# Syncs the upstream Codex source only when Codex is in the changed-tool list.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
ref_dir="$repo_root/references/codex"

if [ "${FORCE_CODEX_SYNC:-0}" = "1" ]; then
  old_revision="$(awk -F' = ' '$1 == "revision" { print $2; exit }' "$repo_root/codex/VERSION")"
  package_version="$(npm view @openai/codex version --json | jq -er '.')"
  new_revision="$(git ls-remote --tags https://github.com/openai/codex.git \
    "refs/tags/rust-v${package_version}^{}" | cut -f1)"
  if [ -z "$new_revision" ]; then
    new_revision="$(git ls-remote --tags https://github.com/openai/codex.git \
      "refs/tags/rust-v${package_version}" | cut -f1)"
  fi
  [ -n "$new_revision" ] || { echo "Could not resolve Codex release rust-v$package_version." >&2; exit 1; }
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

  new_revision="$(jq -er '.[] | select(.tool == "codex") | .new_revision' "$changed_file")"
  old_revision="$(jq -er '.[] | select(.tool == "codex") | .old_revision' "$changed_file")"
fi

if [ -d "$ref_dir/.git" ]; then
  git -C "$ref_dir" remote set-url origin https://github.com/openai/codex.git
else
  mkdir -p "$repo_root/references"
  git init --quiet "$ref_dir"
  git -C "$ref_dir" remote add origin https://github.com/openai/codex.git
fi
if ! git -C "$ref_dir" cat-file -e "${new_revision}^{commit}" 2>/dev/null; then
  timeout 5m git -C "$ref_dir" -c core.hooksPath=/dev/null fetch --quiet --depth 1 origin "$new_revision"
fi
git -C "$ref_dir" -c core.hooksPath=/dev/null checkout --quiet --detach --force "$new_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null reset --quiet --hard "$new_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null clean --quiet -ffdx

# Keep the prior captured revision available for source-level comparisons without
# retaining the upstream repository's complete history.
if ! git -C "$ref_dir" cat-file -e "${old_revision}^{commit}" 2>/dev/null; then
  timeout 5m git -C "$ref_dir" -c core.hooksPath=/dev/null fetch --quiet --depth 1 origin "$old_revision" || \
    echo "::warning::Could not fetch prior Codex revision $old_revision"
fi

git -C "$ref_dir" cat-file -e "${old_revision}^{commit}" 2>/dev/null || {
  echo "Prior Codex revision $old_revision is unavailable for comparison." >&2
  exit 1
}

# Materialize every blob needed by the old/new release comparison before this
# repository is cached and later mounted read-only. The second pass forbids
# lazy fetching and proves the cached source is self-contained.
timeout 10m git -C "$ref_dir" diff --binary --no-ext-diff "$old_revision" "$new_revision" -- >/dev/null
GIT_NO_LAZY_FETCH=1 timeout 10m git -C "$ref_dir" diff --binary --no-ext-diff \
  "$old_revision" "$new_revision" -- >/dev/null

echo "references/codex is at $(git -C "$ref_dir" rev-parse HEAD)"
