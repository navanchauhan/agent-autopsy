#!/usr/bin/env bash
# Invokes `codex exec` once, acting as an orchestrator that spawns one subagent
# per changed tool (see codex-orchestrator-prompt.md). Codex does the content
# diffing/rewriting; it never touches git itself. This script only decides
# whether to run codex at all, and captures its final report for the commit step.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
summary_file="${CODEX_SUMMARY_FILE:-$scratch_dir/codex-summary.md}"
mkdir -p "$scratch_dir"

if [ ! -s "$changed_file" ] || [ "$(cat "$changed_file")" = "[]" ]; then
  echo "No changed tools ($changed_file is empty) — skipping codex exec." >&2
  echo "No tools changed today." > "$summary_file"
  exit 0
fi

echo "Changed tools:" >&2
cat "$changed_file" >&2

export CHANGED_TOOLS_FILE="$changed_file"

codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  -C "$repo_root" \
  --output-last-message "$summary_file" \
  - < "$(dirname "${BASH_SOURCE[0]}")/codex-orchestrator-prompt.md"

echo "codex exec finished. Summary written to $summary_file:" >&2
cat "$summary_file" >&2
