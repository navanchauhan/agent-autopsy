#!/usr/bin/env bash
# Runs an agent-owned capture refresh, a small mechanical gate, and an independent
# evidence review. The human-facing result remains Markdown for GitHub releases.

set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
script_dir="$repo_root/.github/scripts"
if [ -n "${TRUSTED_SCRIPT_DIR:-}" ]; then
  script_dir="$TRUSTED_SCRIPT_DIR"
fi
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
state_dir="${CODEX_STATE_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
summary_file="${CODEX_SUMMARY_FILE:-$scratch_dir/codex-summary.md}"
validation_file="${CODEX_VALIDATION_FILE:-$scratch_dir/validation.txt}"
review_file="${CODEX_REVIEW_FILE:-$scratch_dir/review-result.json}"
author_model="${CODEX_REFRESH_MODEL:-gpt-5.6-luna}"
author_effort="${CODEX_REFRESH_REASONING_EFFORT:-medium}"
review_model="${CODEX_REVIEW_MODEL:-gpt-5.6-luna}"
review_effort="${CODEX_REVIEW_REASONING_EFFORT:-medium}"
author_timeout="${CODEX_AUTHOR_TIMEOUT:-25m}"
review_timeout="${CODEX_REVIEW_TIMEOUT:-12m}"
phase="${CODEX_DRIVER_PHASE:-full}"
attempt="${CODEX_DRIVER_ATTEMPT:-1}"

mkdir -p "$scratch_dir" "$state_dir"

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

write_secure_config() {
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  local config_file="$codex_home/config.toml"
  local temp_file
  local dirs=()
  local dir
  while IFS= read -r dir; do
    dirs+=("$dir")
  done < <(jq -r '.[].dir' "$changed_file")
  for dir in "${dirs[@]}"; do
    case "$dir" in
      codex|claude-code|grok|antigravity) ;;
      *) echo "Unsupported writable tool directory: $dir" >&2; return 2 ;;
    esac
  done
  mkdir -p "$codex_home"
  temp_file="$(mktemp "$codex_home/.refresh-config.XXXXXX")"
  chmod 600 "$temp_file"
  {
    printf '%s\n' \
      'default_permissions = "author"' \
      'allow_login_shell = false' \
      '[shell_environment_policy]' \
      'inherit = "core"' \
      'ignore_default_excludes = false' \
      'include_only = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "PWD", "REPO_ROOT", "CHANGED_TOOLS_FILE", "CAPTURE_SCRATCH_DIR", "CODEX_WORK_DIR", "CODEX_SUMMARY_FILE", "CODEX_VALIDATION_FILE", "CODEX_REVIEW_FILE", "REFRESH_BASE_REF"]'
    printf '[shell_environment_policy.set]\n'
    printf 'REPO_ROOT = %s\n' "$(jq -Rn --arg value "$repo_root" '$value')"
    printf 'CHANGED_TOOLS_FILE = %s\n' "$(jq -Rn --arg value "$changed_file" '$value')"
    printf 'CAPTURE_SCRATCH_DIR = %s\n' "$(jq -Rn --arg value "$scratch_dir" '$value')"
    printf 'CODEX_WORK_DIR = %s\n' "$(jq -Rn --arg value "${CODEX_WORK_DIR:-$state_dir/work}" '$value')"
    printf 'CODEX_SUMMARY_FILE = %s\n' "$(jq -Rn --arg value "$summary_file" '$value')"
    printf 'CODEX_VALIDATION_FILE = %s\n' "$(jq -Rn --arg value "$validation_file" '$value')"
    printf 'CODEX_REVIEW_FILE = %s\n' "$(jq -Rn --arg value "$review_file" '$value')"
    printf 'REFRESH_BASE_REF = %s\n' "$(jq -Rn --arg value "${REFRESH_BASE_REF:-HEAD}" '$value')"
    printf '[permissions.author.filesystem]\n'
    printf '":root" = "read"\n'
    printf '"%s/auth.json" = "deny"\n' "$codex_home"
    printf '"/credential-state" = "deny"\n'
    printf '"/proc" = "deny"\n'
    printf '"/sys" = "deny"\n'
    printf '"%s" = "write"\n' "${CODEX_WORK_DIR:-$state_dir/work}"
    for dir in "${dirs[@]}"; do
      printf '"%s/%s" = "write"\n' "$repo_root" "$dir"
    done
    printf '%s\n' \
      '[permissions.author.network]' \
      'enabled = false' \
      '[permissions.review.filesystem]' \
      '":root" = "read"'
    printf '"%s/auth.json" = "deny"\n' "$codex_home"
    printf '"/credential-state" = "deny"\n'
    printf '"/proc" = "deny"\n'
    printf '"/sys" = "deny"\n'
    printf '%s\n' \
      '[permissions.review.network]' \
      'enabled = false'
  } >"$temp_file"
  mv -f "$temp_file" "$config_file"
}

write_secure_config

run_author() {
  local prompt_file="$1"
  timeout --foreground --signal=TERM --kill-after=30s "$author_timeout" codex exec \
    --model "$author_model" \
    -c "model_reasoning_effort=\"$author_effort\"" \
    -c 'model_verbosity="low"' \
    --strict-config \
    --ignore-rules \
    --ephemeral \
    -c 'default_permissions="author"' \
    -c 'approval_policy="never"' \
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
  timeout --foreground --signal=TERM --kill-after=30s "$review_timeout" codex exec \
    --model "$review_model" \
    -c "model_reasoning_effort=\"$review_effort\"" \
    -c 'model_verbosity="low"' \
    --strict-config \
    --ignore-rules \
    --ephemeral \
    -c 'default_permissions="review"' \
    -c 'approval_policy="never"' \
    -C "$repo_root" \
    --output-schema "$script_dir/review-result.schema.json" \
    --output-last-message "$review_file" \
    - < "$script_dir/review-refresh-prompt.md"

  node "$script_dir/validate-review.cjs" "$changed_file" "$review_file"
}

has_scoped_changes() {
  local dirs=()
  local dir
  while IFS= read -r dir; do
    dirs+=("$dir")
  done < <(jq -r '.[].dir' "$changed_file")
  [ "${#dirs[@]}" -gt 0 ] || return 1
  [ -n "$(git -C "$repo_root" status --porcelain -- "${dirs[@]}" CATALOG.md)" ]
}

finalize_surface_metadata() {
  local dirs=()
  local dir
  while IFS= read -r dir; do
    dirs+=("$dir")
  done < <(jq -r '.[].dir' "$changed_file")
  node "$script_dir/update-version-counts.cjs" "${dirs[@]}"
  node "$script_dir/update-surface-hashes.cjs" "${dirs[@]}"
  node "$script_dir/generate-catalog.cjs"
}

candidate_fingerprint() {
  bash "$script_dir/hash-candidate.sh" "$changed_file"
}

write_safe_retry_summary() {
  local temp_summary
  temp_summary="$(mktemp "$state_dir/.retry-summary.XXXXXX")"
  jq -r '
    .[]
    | "## \(.tool)\n\nNo tracked update was produced for \(.old_version) to \(.new_version). The supplied evidence was insufficient or non-material, so the existing capture remains unchanged and this target should be retried after fresh evidence is available."
  ' "$changed_file" >"$temp_summary"
  mv -f "$temp_summary" "$summary_file"
}

run_author_phase() {
  if [ "$attempt" -eq 1 ]; then
    rm -f "$summary_file"
    run_author "$script_dir/codex-orchestrator-prompt.md"
  elif [ "$attempt" -eq 2 ] || [ "$attempt" -eq 3 ] || [ "$attempt" -eq 4 ]; then
    run_author "$script_dir/codex-revise-prompt.md"
  else
    echo "CODEX_DRIVER_ATTEMPT must be 1, 2, 3, or 4" >&2
    return 2
  fi

  if ! has_scoped_changes; then
    # The model's final message is untrusted even when it correctly leaves the
    # repository unchanged. Replace it with a deterministic, plan-derived
    # summary so the safe-retry path cannot fail packaging and spend the same
    # normalization tokens again on the next poll.
    write_safe_retry_summary
    validate_candidate
    node "$script_dir/write-safe-retry.cjs" "$changed_file" "$review_file" \
      "Codex left every tracked tool unchanged because the available evidence was insufficient or non-material."
    node "$script_dir/validate-review.cjs" "$changed_file" "$review_file"
    rm -f "$state_dir/candidate-tree.sha256"
    return 0
  fi

  finalize_surface_metadata
  validate_candidate
  candidate_fingerprint >"$state_dir/candidate-tree.sha256"
}

run_review_phase() {
  local expected actual after
  validate_candidate
  [ -s "$state_dir/candidate-tree.sha256" ] || {
    echo "Trusted author fingerprint is missing." >&2
    return 1
  }
  expected="$(tr -d '[:space:]' <"$state_dir/candidate-tree.sha256")"
  actual="$(candidate_fingerprint)"
  [ "$expected" = "$actual" ] || {
    echo "Candidate changed after the isolated author container exited." >&2
    return 1
  }
  run_reviewer
  after="$(candidate_fingerprint)"
  [ "$expected" = "$after" ] || {
    echo "Candidate changed during independent review." >&2
    return 1
  }
}

run_smoke_phase() {
  local tool_dir
  tool_dir="$(jq -er '.[0].dir' "$changed_file")"
  case "$tool_dir" in
    codex|claude-code|grok|antigravity) ;;
    *) echo "Unsupported smoke-test tool directory: $tool_dir" >&2; return 2 ;;
  esac
  mkdir -p "${CODEX_WORK_DIR:-$state_dir/work}"
  codex sandbox -P author -C "$repo_root" -- \
    bash "$script_dir/test-codex-sandbox.sh" author "$tool_dir"
  rm -f "${CODEX_WORK_DIR:-$state_dir/work}/.author-write" "$repo_root/$tool_dir/.author-write"
  codex sandbox -P review -C "$repo_root" -- \
    bash "$script_dir/test-codex-sandbox.sh" review "$tool_dir"
}

case "$phase" in
  author)
    run_author_phase
    exit $?
    ;;
  review)
    run_review_phase
    exit $?
    ;;
  smoke)
    run_smoke_phase
    exit $?
    ;;
  full) ;;
  *) echo "CODEX_DRIVER_PHASE must be author, review, smoke, or full" >&2; exit 2 ;;
esac

for attempt in 1 2 3 4; do
  if ! run_author_phase; then
    if [ "$attempt" -lt 4 ]; then
      continue
    fi
    echo "Refresh failed mechanical validation after three repair attempts." >&2
    exit 1
  fi

  if ! has_scoped_changes; then
    echo "No candidate diff; stopping before independent review and repair retries." >&2
    exit 0
  fi

  if run_review_phase; then
    decision="$(jq -r '.decision' "$review_file")"
    echo "Refresh review completed with decision=$decision; model-authored output remains suppressed from CI logs." >&2
    exit 0
  fi

  if [ -f "$review_file" ]; then
    echo "Independent reviewer output failed its trusted schema or policy gate." >&2
  else
    echo "Independent reviewer did not produce $review_file." >&2
  fi
  if [ "$attempt" -eq 4 ]; then
    echo "Refresh was not approved after three repair attempts." >&2
    exit 1
  fi
done
