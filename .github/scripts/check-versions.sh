#!/usr/bin/env bash
# Compares freshly installed CLI/source versions with <tool>/VERSION and writes
# the changed-tool list used by the refresh job.

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
  local name="$1" dir="$2" field="$3" version_cmd="$4" version_regex="$5"

  local recorded_version
  recorded_version="$(current_version_field "$repo_root/$dir/VERSION" "$field" || true)"

  echo "== $name ==" >&2
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

check_codex_source() {
  # Codex is captured from OpenAI's own open-source tree (see codex/README.md),
  # not from the installed npm CLI's own behavior — so "is there something new
  # to capture" means "did codex-rs/openai/codex's default branch move past the
  # revision we last captured," not "did the npm package version string change."
  # (The npm package version can lag behind — or occasionally sit ahead of —
  # actual source content changes, so it's the wrong signal here.) This needs
  # no local clone and no codex CLI install at all, just one `git ls-remote`.
  local recorded_revision
  recorded_revision="$(current_version_field "$repo_root/codex/VERSION" "revision")"

  echo "== codex (source) ==" >&2
  local latest_revision
  latest_revision="$(git ls-remote https://github.com/openai/codex.git HEAD 2>/dev/null | cut -f1)"

  if [ -z "$latest_revision" ]; then
    echo "::warning::Could not reach github.com/openai/codex.git; skipping version check for codex" >&2
    return
  fi

  echo "codex: recorded_revision=$recorded_revision latest_revision=$latest_revision" >&2

  if [ "$latest_revision" != "$recorded_revision" ]; then
    entries+=("{\"tool\":\"codex\",\"dir\":\"codex\",\"old_version\":\"$recorded_revision\",\"new_version\":\"$latest_revision\"}")
  fi
}

check_tool "claude-code" "claude-code" "version" \
  "claude --version" '[0-9]+\.[0-9]+\.[0-9]+'

check_codex_source

check_tool "antigravity" "antigravity" "version" \
  "agy --version" '[0-9]+\.[0-9]+\.[0-9]+'

check_grok_source() {
  local recorded_revision mirror_revision latest_revision
  recorded_revision="$(current_version_field "$repo_root/grok/VERSION" "revision")"
  echo "== grok (source) ==" >&2
  mirror_revision="$(git ls-remote https://github.com/xai-org/grok-build.git HEAD 2>/dev/null | cut -f1)"
  if [ -z "$mirror_revision" ]; then
    echo "::warning::Could not reach github.com/xai-org/grok-build.git; skipping version check for grok" >&2
    return
  fi
  latest_revision="$(curl -fsSL "https://raw.githubusercontent.com/xai-org/grok-build/$mirror_revision/SOURCE_REV" 2>/dev/null | tr -d '[:space:]')"
  if ! [[ "$latest_revision" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::warning::Could not read a valid Grok SOURCE_REV from $mirror_revision; skipping version check for grok" >&2
    return
  fi
  echo "grok: recorded_revision=$recorded_revision source_revision=$latest_revision mirror_revision=$mirror_revision" >&2
  if [ "$latest_revision" != "$recorded_revision" ]; then
    entries+=("{\"tool\":\"grok\",\"dir\":\"grok\",\"old_version\":\"$recorded_revision\",\"new_version\":\"$latest_revision\"}")
  fi
}

check_grok_source

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
  echo "changed_tools=$(tr -d '\n' < "$changed_file")" >> "$GITHUB_OUTPUT"
  echo "changed_tools_file=$changed_file" >> "$GITHUB_OUTPUT"
fi
