#!/usr/bin/env bash
# Capture Claude Code's documented headless and interactive request variants.
# Credentials must already be present in CLAUDE_CODE_OAUTH_TOKEN or Claude's
# normal credential store. All retained output stays below CAPTURE_SCRATCH_DIR.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
tool_scratch="$scratch_root/claude-code"
raw_root="$tool_scratch/raw"
candidate_dir="${CLAUDE_CANDIDATE_DIR:-$tool_scratch/candidate}"
trace_script="$repo_root/claude-code/misc/scripts/trace-claude-messages.cjs"
extract_script="$repo_root/claude-code/misc/scripts/extract-claude-trace.cjs"
discover_deferred_script="$repo_root/claude-code/misc/scripts/discover-claude-deferred-tools.cjs"

headless_timeout="${CLAUDE_HEADLESS_TIMEOUT_SECONDS:-120}"
interactive_timeout="${CLAUDE_INTERACTIVE_TIMEOUT_SECONDS:-180}"
parallelism="${CLAUDE_CAPTURE_PARALLELISM:-3}"
headless_attempts="${CLAUDE_HEADLESS_ATTEMPTS:-2}"
export DISABLE_AUTOUPDATER=1

default_models=(
  claude-fable-5
  claude-haiku-4-5-20251001
  claude-opus-4-7
  claude-opus-4-8
  claude-opus-5
  claude-sonnet-4-6
  claude-sonnet-5
)

if [ -n "${CLAUDE_CAPTURE_MODELS:-}" ]; then
  read -r -a models <<<"$CLAUDE_CAPTURE_MODELS"
else
  models=("${default_models[@]}")
fi

deferred_names_to_csv() {
  local discovered="$1"
  printf '%s\n' "$discovered" | paste -sd, -
}

die() {
  echo "capture-claude-code: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_positive_integer() {
  local name="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*|0) die "$name must be a positive integer, got: $value" ;;
  esac
}

for command_name in awk claude jq mktemp node paste timeout tmux; do
  require_command "$command_name"
done
require_positive_integer CLAUDE_HEADLESS_TIMEOUT_SECONDS "$headless_timeout"
require_positive_integer CLAUDE_INTERACTIVE_TIMEOUT_SECONDS "$interactive_timeout"
require_positive_integer CLAUDE_CAPTURE_PARALLELISM "$parallelism"
require_positive_integer CLAUDE_HEADLESS_ATTEMPTS "$headless_attempts"
[ "$headless_attempts" -le 3 ] || die "CLAUDE_HEADLESS_ATTEMPTS must not exceed 3"
[ "${#models[@]}" -gt 0 ] || die "no Claude models were selected"

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ ! -s "${HOME:?HOME must be set}/.claude/.credentials.json" ]; then
  die "no seeded Claude credential found (set CLAUDE_CODE_OAUTH_TOKEN or restore ~/.claude/.credentials.json)"
fi

mkdir -p "$raw_root"
headless_trace_dir="$(mktemp -d "$raw_root/headless.XXXXXX")"
headless_output_dir="$headless_trace_dir/outputs"
mkdir -p "$headless_output_dir"

trace_record_matches() {
  local file="$1" marker="$2" required_tools_csv="${3:-}"
  jq -e --arg marker "$marker" --arg required "$required_tools_csv" '
    . as $record
    | ($record.request.body? | fromjson?) as $body
    | select(($body | tostring | contains($marker)))
    | select(
        $record.response.ok == true
        and $record.response.completed == true
        and $record.response.error_event != true
        and ($record.response.status >= 200 and $record.response.status < 300)
        and (($body.stream // false) != true or $record.response.terminal_event == true)
      )
    | ($required | split(",") | map(select(length > 0))) as $required_names
    | [$body.tools[]?.name] as $tool_names
    | all(
        $required_names[];
        . as $required_name | ($tool_names | index($required_name)) != null
      )
  ' "$file" >/dev/null 2>&1
}

trace_has_session_title() {
  local file="$1"
  jq -e '
    . as $record
    | ($record.request.body? | fromjson?) as $body
    | select(
        ($body | tostring | contains("Generate a concise, sentence-case title"))
        and (($body.tools // []) | length == 0)
      )
    | select(
        $record.response.ok == true
        and $record.response.completed == true
        and $record.response.error_event != true
        and ($record.response.status >= 200 and $record.response.status < 300)
        and (($body.stream // false) != true or $record.response.terminal_event == true)
      )
  ' "$file" >/dev/null 2>&1
}

wait_for_trace_marker() {
  local trace_dir="$1" marker="$2" required_tools_csv="${3:-}"
  local timeout_seconds="${4:-15}" exit_file="${5:-}"
  local deadline=$((SECONDS + timeout_seconds))

  while [ "$SECONDS" -lt "$deadline" ]; do
    local file
    for file in "$trace_dir"/*.json; do
      [ -f "$file" ] || continue
      if trace_record_matches "$file" "$marker" "$required_tools_csv"; then
        return 0
      fi
    done

    if [ -n "$exit_file" ] && [ -s "$exit_file" ]; then
      local exit_status
      exit_status="$(tr -d '[:space:]' <"$exit_file")"
      echo "capture-claude-code: interactive Claude exited before completing $marker (status $exit_status)" >&2
      return 1
    fi
    sleep 1
  done

  echo "capture-claude-code: timed out waiting for a successful trace for $marker" >&2
  return 1
}

trace_marker_available() {
  local trace_dir="$1" marker="$2" required_tools_csv="${3:-}" file
  for file in "$trace_dir"/*.json; do
    [ -f "$file" ] || continue
    trace_record_matches "$file" "$marker" "$required_tools_csv" && return 0
  done
  return 1
}

wait_for_session_title() {
  local trace_dir="$1" timeout_seconds="${2:-15}"
  local deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local file
    for file in "$trace_dir"/*.json; do
      [ -f "$file" ] || continue
      if trace_has_session_title "$file"; then
        return 0
      fi
    done
    sleep 1
  done
  echo "capture-claude-code: no successful session-title request was captured" >&2
  return 1
}

echo "Checking Claude authentication without making a model request..."
auth_status="$(claude auth status --json 2>/dev/null || true)"
jq -e '.loggedIn == true' <<<"$auth_status" >/dev/null || \
  die "claude auth status reports no usable login"

capture_headless_request() {
  local model="$1" kind="$2" prompt="$3" marker="$4" required_tools_csv="${5:-}"
  local safe_model="${model//[^A-Za-z0-9_.-]/_}"
  local stdout_file="$headless_output_dir/$safe_model-$kind.json"
  local stderr_file="$headless_output_dir/$safe_model-$kind.stderr.log"
  local max_turns=1
  [ "$kind" = "deferred" ] && max_turns=2

  if ! CLAUDE_TRACE_DIR="$headless_trace_dir" \
    BUN_OPTIONS="--preload=$trace_script" \
    timeout --foreground --signal=TERM --kill-after=10s "${headless_timeout}s" \
      claude -p "$prompt" --model "$model" --output-format json \
        --max-turns "$max_turns" --no-session-persistence \
        --exclude-dynamic-system-prompt-sections --strict-mcp-config --tools default \
        >"$stdout_file" 2>"$stderr_file"; then
    echo "capture-claude-code: $model $kind request failed; see $stderr_file" >&2
    return 1
  fi

  if ! grep -Fq "$marker" "$stdout_file"; then
    echo "capture-claude-code: $model $kind response omitted $marker" >&2
    return 1
  fi

  wait_for_trace_marker "$headless_trace_dir" "$marker" "$required_tools_csv" 15
}

capture_headless_model() {
  local model="$1"
  local base_marker="TRACE_FETCH_${model}"
  local deferred_marker="DEFERRED_TRACE_OK_${model}"
  local discovered deferred_csv deferred_query max_results

  echo "Capturing Claude headless requests for $model..."
  if ! trace_marker_available "$headless_trace_dir" "$base_marker"; then
    capture_headless_request \
      "$model" base "Reply exactly: $base_marker" "$base_marker"
  fi
  discovered="$(node "$discover_deferred_script" "$headless_trace_dir" "$base_marker" --allow-none)"
  deferred_csv="$(deferred_names_to_csv "$discovered")"
  if [ -z "$deferred_csv" ]; then
    echo "Claude $model advertised no deferred tools; skipping the expansion turn."
    return 0
  fi
  deferred_query="select:$deferred_csv"
  max_results="$(awk -F, '{ print NF }' <<<"$deferred_csv")"
  if ! trace_marker_available "$headless_trace_dir" "$deferred_marker" "$deferred_csv"; then
    capture_headless_request \
      "$model" deferred \
      "Use ToolSearch once with query \"$deferred_query\" and max_results $max_results, then reply exactly: $deferred_marker" \
      "$deferred_marker" "$deferred_csv"
  fi
}

wait_for_batch() {
  local failed=0 pid
  for pid in "$@"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  [ "$failed" -eq 0 ]
}

interactive_trace_dir="$(mktemp -d "$raw_root/interactive.XXXXXX")"
interactive_exit_file="$interactive_trace_dir/claude-exit-status"
tmux_session="claude-capture-$$-$RANDOM"

cleanup_tmux() {
  if [ -n "${tmux_session:-}" ] && tmux has-session -t "$tmux_session" 2>/dev/null; then
    tmux kill-session -t "$tmux_session" 2>/dev/null || true
  fi
}
trap cleanup_tmux EXIT
trap 'exit 130' INT TERM HUP

wait_for_interactive_ready() {
  local deadline=$((SECONDS + 30)) pane
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ ! -s "$interactive_exit_file" ] || die "interactive Claude exited during startup"
    pane="$(tmux capture-pane -p -t "$tmux_session:0.0" 2>/dev/null || true)"
    if grep -Eqi 'quick safety check|trust this folder|bypass permissions|dangerous mode|accept.*disclaimer' <<<"$pane"; then
      echo "Claude interactive output was suppressed from CI logs." >&2
      die "interactive Claude stopped at a first-run safety dialog"
    fi
    if grep -Eqi 'Claude Code|What can I help|Try "' <<<"$pane"; then
      return 0
    fi
    sleep 1
  done
  echo "Claude interactive startup output was suppressed from CI logs." >&2
  die "interactive Claude did not reach a ready prompt"
}

tmux_args=(
  new-session -d -s "$tmux_session" -c "$repo_root"
  -e "BUN_OPTIONS=--preload=$trace_script"
  -e "CLAUDE_TRACE_DIR=$interactive_trace_dir"
  -e "CLAUDE_CAPTURE_EXIT_FILE=$interactive_exit_file"
  -e "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}"
  -e "DISABLE_AUTOUPDATER=1"
)

# Expanded by the shell tmux starts, not by this capture wrapper.
# shellcheck disable=SC2016
interactive_command='claude --permission-mode dontAsk --strict-mcp-config --tools default; capture_status=$?; printf "%s\n" "$capture_status" > "$CLAUDE_CAPTURE_EXIT_FILE"; exec sleep 86400'
tmux "${tmux_args[@]}" "$interactive_command"

wait_for_interactive_ready

send_interactive_prompt() {
  local prompt="$1"
  tmux send-keys -t "$tmux_session" -l -- "$prompt"
  tmux send-keys -t "$tmux_session" Enter
}

interactive_base_marker="CLAUDE_INTERACTIVE_TRACE_OK"
echo "Capturing Claude interactive base request..."
send_interactive_prompt "Reply exactly: $interactive_base_marker"
wait_for_trace_marker \
  "$interactive_trace_dir" "$interactive_base_marker" "" \
  "$interactive_timeout" "$interactive_exit_file" || \
  die "interactive base capture is incomplete"

interactive_discovered="$(node "$discover_deferred_script" "$interactive_trace_dir" "$interactive_base_marker" --allow-none)"
interactive_deferred_csv="$(deferred_names_to_csv "$interactive_discovered")"
if [ -n "$interactive_deferred_csv" ]; then
  interactive_deferred_query="select:$interactive_deferred_csv"
  interactive_deferred_max="$(awk -F, '{ print NF }' <<<"$interactive_deferred_csv")"

  interactive_deferred_marker="CLAUDE_INTERACTIVE_DEFERRED_TRACE_OK"
  echo "Capturing Claude interactive deferred-tool expansion..."
  send_interactive_prompt \
    "Use ToolSearch once with query \"$interactive_deferred_query\" and max_results $interactive_deferred_max, then reply exactly: $interactive_deferred_marker"
  wait_for_trace_marker \
    "$interactive_trace_dir" "$interactive_deferred_marker" "$interactive_deferred_csv" \
    "$interactive_timeout" "$interactive_exit_file" || \
    die "interactive deferred-tool capture is incomplete"
else
  echo "Claude interactive mode advertised no deferred tools; skipping the expansion turn."
fi
wait_for_session_title "$interactive_trace_dir" "$interactive_timeout" || \
  die "interactive session-title capture is incomplete"

send_interactive_prompt "/exit"
for _ in {1..10}; do
  [ -s "$interactive_exit_file" ] && break
  sleep 1
done
cleanup_tmux
tmux_session=""

# Interactive authentication and first-run state are the most failure-prone
# part of Claude capture, so prove them before spending headless turns. Retry
# only incomplete model/mode units inside this run; successful base or deferred
# traces are validated and reused without another model request.
pending_models=("${models[@]}")
for ((round = 1; round <= headless_attempts; round += 1)); do
  headless_pids=()
  for model in "${pending_models[@]}"; do
    safe_model="${model//[^A-Za-z0-9_.-]/_}"
    (
      capture_headless_model "$model"
      : >"$headless_output_dir/$safe_model.complete"
    ) &
    headless_pids+=("$!")
    if [ "${#headless_pids[@]}" -ge "$parallelism" ]; then
      wait_for_batch "${headless_pids[@]}" || true
      headless_pids=()
    fi
  done
  if [ "${#headless_pids[@]}" -gt 0 ]; then
    wait_for_batch "${headless_pids[@]}" || true
  fi
  next_pending=()
  for model in "${pending_models[@]}"; do
    safe_model="${model//[^A-Za-z0-9_.-]/_}"
    [ -f "$headless_output_dir/$safe_model.complete" ] || next_pending+=("$model")
  done
  pending_models=("${next_pending[@]}")
  [ "${#pending_models[@]}" -gt 0 ] || break
  if [ "$round" -lt "$headless_attempts" ]; then
    echo "Retrying ${#pending_models[@]} incomplete Claude model capture(s), round $((round + 1))." >&2
  fi
done
[ "${#pending_models[@]}" -eq 0 ] || die "headless Claude capture remained incomplete after $headless_attempts bounded attempt(s)"
rm -f -- "$headless_output_dir"/*.complete

case "$candidate_dir" in
  "$tool_scratch"/*) ;;
  *) die "candidate directory must remain below $tool_scratch" ;;
esac
if [ -e "$candidate_dir" ]; then
  rm -rf -- "$candidate_dir"
fi
mkdir -p "$candidate_dir"
cp -a "$repo_root/claude-code/." "$candidate_dir/"
node "$extract_script" "$interactive_trace_dir" "$candidate_dir"

echo "Claude capture complete."
echo "Headless evidence: $headless_trace_dir"
echo "Interactive evidence: $interactive_trace_dir"
echo "Interactive candidate: $candidate_dir"
