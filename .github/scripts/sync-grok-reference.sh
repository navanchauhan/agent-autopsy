#!/usr/bin/env bash
# Synchronize the public Grok source mirror to the exact mirror revision from
# the capture plan, then verify its SOURCE_REV provenance.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
ref_dir="$repo_root/references/grok-build"

if [ ! -s "$changed_file" ] || ! jq -e 'any(.[]; .tool == "grok")' "$changed_file" >/dev/null; then
  echo "Grok is unchanged; skipping references/grok-build sync."
  exit 0
fi

mirror_revision="$(jq -er '.[] | select(.tool == "grok") | .mirror_revision' "$changed_file")"
source_revision="$(jq -er '.[] | select(.tool == "grok") | .new_revision' "$changed_file")"
expected_version="$(jq -er '.[] | select(.tool == "grok") | .new_version' "$changed_file")"
[[ "$mirror_revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid Grok mirror revision." >&2; exit 1; }
[[ "$source_revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid Grok SOURCE_REV." >&2; exit 1; }

if [ ! -d "$ref_dir/.git" ]; then
  mkdir -p "$repo_root/references"
  git init --quiet "$ref_dir"
  git -C "$ref_dir" remote add origin https://github.com/xai-org/grok-build.git
fi
git -C "$ref_dir" remote set-url origin https://github.com/xai-org/grok-build.git
if ! git -C "$ref_dir" cat-file -e "${mirror_revision}^{commit}" 2>/dev/null; then
  git -C "$ref_dir" -c core.hooksPath=/dev/null fetch --quiet --depth 2 origin "$mirror_revision"
elif ! git -C "$ref_dir" cat-file -e "${mirror_revision}^" 2>/dev/null; then
  # The semantic source inventory compares the release snapshot with its
  # parent. A prior depth-one cache contains the release but hides that delta.
  git -C "$ref_dir" -c core.hooksPath=/dev/null fetch --quiet --depth 2 origin "$mirror_revision"
fi
git -C "$ref_dir" -c core.hooksPath=/dev/null checkout --quiet --detach --force "$mirror_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null reset --quiet --hard "$mirror_revision"
git -C "$ref_dir" -c core.hooksPath=/dev/null clean --quiet -ffdx

actual_source_revision="$(tr -d '[:space:]' <"$ref_dir/SOURCE_REV")"
if [ "$actual_source_revision" != "$source_revision" ]; then
  echo "Grok SOURCE_REV mismatch: expected $source_revision, found $actual_source_revision" >&2
  exit 1
fi
actual_version="$(awk -F'"' '/^version = "/ { print $2; exit }' \
  "$ref_dir/crates/codegen/xai-grok-shell/Cargo.toml")"
changelog="$ref_dir/crates/codegen/xai-grok-shell/changelogs/$expected_version.md"
if [ ! -s "$changelog" ]; then
  echo "Grok mirror does not contain the $expected_version release changelog." >&2
  exit 1
fi
if [ "$actual_version" != "$expected_version" ]; then
  # The public mirror batches some adjacent binaries into one source snapshot
  # (for example .113/.114). The version-specific changelog and official binary
  # remain exact; record the shared mirror provenance without fabricating a
  # Cargo revision that was never published.
  if [ -z "$actual_version" ] ||
     [ "$(printf '%s\n%s\n' "$expected_version" "$actual_version" | sort -V | tail -n1)" != "$actual_version" ]; then
    echo "Grok mirror snapshot $actual_version predates expected release $expected_version." >&2
    exit 1
  fi
  echo "::notice::Grok $expected_version shares public mirror snapshot $actual_version." >&2
fi
echo "references/grok-build is at mirror $mirror_revision (SOURCE_REV $source_revision, snapshot $actual_version)"
