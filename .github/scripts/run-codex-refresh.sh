#!/usr/bin/env bash
# Runs an agent-owned capture refresh, a small mechanical gate, and an independent
# evidence review. The human-facing result remains Markdown for GitHub releases.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_dir="$repo_root/.github/scripts"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
summary_file="${CODEX_SUMMARY_FILE:-$scratch_dir/codex-summary.md}"
validation_file="${CODEX_VALIDATION_FILE:-$scratch_dir/validation.txt}"
review_file="${CODEX_REVIEW_FILE:-$scratch_dir/review-result.json}"
author_model="${CODEX_REFRESH_MODEL:-gpt-5.6-sol}"
author_effort="${CODEX_REFRESH_REASONING_EFFORT:-high}"
review_model="${CODEX_REVIEW_MODEL:-gpt-5.6-sol}"
review_effort="${CODEX_REVIEW_REASONING_EFFORT:-high}"
author_timeout="${CODEX_AUTHOR_TIMEOUT:-25m}"
review_timeout="${CODEX_REVIEW_TIMEOUT:-12m}"

mkdir -p "$scratch_dir"

if [ ! -s "$changed_file" ] || jq -e 'length == 0' "$changed_file" >/dev/null; then
  echo "No tools changed today." > "$summary_file"
  exit 0
fi

jq -e 'type == "array" and all(.[]; (.tool | type == "string") and (.dir | type == "string"))' \
  "$changed_file" >/dev/null

export CAPTURE_SCRATCH_DIR="$scratch_dir"
export CHANGED_TOOLS_FILE="$changed_file"
export CODEX_SUMMARY_FILE="$summary_file"
export CODEX_VALIDATION_FILE="$validation_file"
export CODEX_REVIEW_FILE="$review_file"

run_author() {
  local prompt_file="$1"
  timeout --foreground --signal=TERM --kill-after=30s "$author_timeout" codex exec \
    --model "$author_model" \
    -c "model_reasoning_effort=\"$author_effort\"" \
    -c 'model_verbosity="low"' \
    --strict-config \
    --ignore-user-config \
    --ephemeral \
    --dangerously-bypass-approvals-and-sandbox \
    -C "$repo_root" \
    --output-last-message "$summary_file" \
    - < "$prompt_file"
}

validate_candidate() {
  if node "$script_dir/validate-refresh.cjs" "$changed_file" "$summary_file" \
    >"$validation_file" 2>&1; then
    return 0
  fi
  cat "$validation_file" >&2
  return 1
}

run_reviewer() {
  rm -f "$review_file"
  # The reviewer needs the author's live, untracked evidence.
  timeout --foreground --signal=TERM --kill-after=30s "$review_timeout" codex exec \
    --model "$review_model" \
    -c "model_reasoning_effort=\"$review_effort\"" \
    -c 'model_verbosity="low"' \
    --strict-config \
    --ignore-user-config \
    --ephemeral \
    --dangerously-bypass-approvals-and-sandbox \
    -C "$repo_root" \
    --output-schema "$script_dir/review-result.schema.json" \
    --output-last-message "$review_file" \
    - < "$script_dir/review-refresh-prompt.md"

  node "$script_dir/validate-review.cjs" "$changed_file" "$review_file"
}

for attempt in 1 2; do
  if [ "$attempt" -eq 1 ]; then
    run_author "$script_dir/codex-orchestrator-prompt.md"
  else
    run_author "$script_dir/codex-revise-prompt.md"
  fi

  if ! validate_candidate; then
    if [ "$attempt" -eq 1 ]; then
      continue
    fi
    echo "Refresh failed mechanical validation after one repair attempt." >&2
    exit 1
  fi

  if run_reviewer; then
    echo "Refresh approved. Markdown summary:" >&2
    cat "$summary_file" >&2
    exit 0
  fi

  if [ -f "$review_file" ]; then
    cat "$review_file" >&2
  else
    echo "Independent reviewer did not produce $review_file." >&2
  fi
  if [ "$attempt" -eq 2 ]; then
    echo "Refresh was not approved after one repair attempt." >&2
    exit 1
  fi
done
