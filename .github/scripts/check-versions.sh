#!/usr/bin/env bash
# Runs each tool's own self-update, reads its true-latest version, and compares
# against what's recorded in <tool>/VERSION. Writes a JSON summary of what changed
# to $CHANGED_TOOLS_FILE (default: .capture-scratch/changed-tools.json) so the
# codex-cli orchestration step knows which tools actually need a refresh.
#
# This never touches repo content itself — it only decides what needs work.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
mkdir -p "$scratch_dir"

current_version_field() {
  # $1 = VERSION file path, $2 = field name (e.g. "version", "codex_cli_package_version")
  awk -F' = ' -v field="$2" '$1 == field { print $2; exit }' "$1"
}

entries=()

check_tool() {
  local name="$1" dir="$2" field="$3" update_cmd="$4" version_cmd="$5" version_regex="$6"

  local recorded_version
  recorded_version="$(current_version_field "$repo_root/$dir/VERSION" "$field" || true)"

  echo "== $name ==" >&2
  if ! eval "$update_cmd" >&2; then
    echo "::warning::$name update command failed; skipping version check for $name" >&2
    return
  fi

  local raw_version installed_version
  raw_version="$(eval "$version_cmd" 2>&1 || true)"
  installed_version="$(echo "$raw_version" | grep -oE "$version_regex" | head -n1 || true)"

  if [ -z "$installed_version" ]; then
    echo "::warning::Could not parse $name version from: $raw_version" >&2
    return
  fi

  echo "$name: recorded=$recorded_version installed=$installed_version" >&2

  if [ "$installed_version" != "$recorded_version" ]; then
    entries+=("{\"tool\":\"$name\",\"dir\":\"$dir\",\"old_version\":\"$recorded_version\",\"new_version\":\"$installed_version\"}")
  fi
}

check_tool "claude-code" "claude-code" "version" \
  "claude update" "claude --version" '[0-9]+\.[0-9]+\.[0-9]+'

check_tool "codex" "codex" "codex_cli_package_version" \
  "codex update" "codex --version" '[0-9]+\.[0-9]+\.[0-9]+'

check_tool "antigravity" "antigravity" "version" \
  "agy update" "agy --version" '[0-9]+\.[0-9]+\.[0-9]+'

check_tool "grok" "grok" "version" \
  "grok update" "grok --version" '[0-9]+\.[0-9]+\.[0-9]+'

{
  printf '['
  for i in "${!entries[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '%s' "${entries[$i]}"
  done
  printf ']\n'
} > "$changed_file"

echo "Wrote $changed_file:" >&2
cat "$changed_file" >&2

if [ "${GITHUB_OUTPUT:-}" != "" ]; then
  if [ "${#entries[@]}" -eq 0 ]; then
    echo "has_changes=false" >> "$GITHUB_OUTPUT"
  else
    echo "has_changes=true" >> "$GITHUB_OUTPUT"
  fi
  echo "changed_tools_file=$changed_file" >> "$GITHUB_OUTPUT"
fi
