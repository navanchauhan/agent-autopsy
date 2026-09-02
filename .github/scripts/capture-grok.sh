#!/usr/bin/env bash
# Capture the Grok CLI's model-facing requests in non-interactive and interactive
# modes, verify successful response evidence, and extract a normalized candidate.

set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
tool_scratch="$scratch_root/grok"
raw_root="$tool_scratch/raw"
candidate_dir="$tool_scratch/candidate"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_root/changed-tools.json}"
target_version="$(jq -er '.[] | select(.tool == "grok") | .new_version' "$changed_file")"
mirror_revision="$(jq -er '.[] | select(.tool == "grok") | .mirror_revision' "$changed_file")"

grok_bin="${GROK_BIN:-grok}"
proxy_port="${GROK_CAPTURE_PORT:-8899}"
startup_timeout="${CAPTURE_STARTUP_TIMEOUT_SECONDS:-20}"
response_timeout="${CAPTURE_RESPONSE_TIMEOUT_SECONDS:-180}"
command_timeout="${GROK_COMMAND_TIMEOUT_SECONDS:-240}"
extraction_timeout="${CAPTURE_EXTRACTION_TIMEOUT_SECONDS:-60}"
poll_interval="${CAPTURE_POLL_INTERVAL_SECONDS:-1}"

noninteractive_marker="GROK_TRACE_OK"
interactive_marker="GROK_INTERACTIVE_TRACE_OK"
tmux_session="grok-capture-$$"
proxy_pid=""

usage() {
  cat <<'EOF'
Usage: bash .github/scripts/capture-grok.sh

Captures Grok non-interactive, interactive, and session-title requests under
$CAPTURE_SCRATCH_DIR/grok/raw and writes normalized candidates under
$CAPTURE_SCRATCH_DIR/grok/candidate.

Optional environment:
  GROK_BIN                           Grok executable (default: grok)
  GROK_CAPTURE_PORT                  mitmproxy port (default: 8899)
  CAPTURE_STARTUP_TIMEOUT_SECONDS    proxy/tmux startup limit (default: 20)
  CAPTURE_RESPONSE_TIMEOUT_SECONDS   response evidence limit (default: 180)
  GROK_COMMAND_TIMEOUT_SECONDS       headless command limit (default: 240)
  CAPTURE_EXTRACTION_TIMEOUT_SECONDS extractor limit (default: 60)
  CAPTURE_POLL_INTERVAL_SECONDS      evidence poll interval (default: 1)
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ "$#" -ne 0 ]; then
  usage >&2
  exit 2
fi

require_positive_integer() {
  local name="$1" value="$2"
  if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$name must be a positive integer, got: $value" >&2
    exit 2
  fi
}

for setting in \
  "GROK_CAPTURE_PORT:$proxy_port" \
  "CAPTURE_STARTUP_TIMEOUT_SECONDS:$startup_timeout" \
  "CAPTURE_RESPONSE_TIMEOUT_SECONDS:$response_timeout" \
  "GROK_COMMAND_TIMEOUT_SECONDS:$command_timeout" \
  "CAPTURE_EXTRACTION_TIMEOUT_SECONDS:$extraction_timeout" \
  "CAPTURE_POLL_INTERVAL_SECONDS:$poll_interval"; do
  require_positive_integer "${setting%%:*}" "${setting#*:}"
done

for command_name in "$grok_bin" mitmdump tmux jq node timeout realpath; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done
grok_executable="$(realpath "$(command -v "$grok_bin")")"
if [ -L "$tool_scratch" ] || [ -L "$raw_root" ]; then
  echo "Refusing to capture through symlinked scratch path: $tool_scratch" >&2
  exit 1
fi

mkdir -p "$raw_root"
work_dir="$(mktemp -d "$raw_root/run.XXXXXX")"
capture_file="$work_dir/capture.jsonl"
proxy_log="$work_dir/mitmdump.log"
noninteractive_stdout="$work_dir/non-interactive.stdout"
noninteractive_stderr="$work_dir/non-interactive.stderr"
interactive_log="$work_dir/interactive.log"

reset_candidate_dir() {
  local resolved_parent resolved_tool_scratch
  if [ -L "$tool_scratch" ]; then
    echo "Refusing to reset candidate through symlinked tool scratch: $tool_scratch" >&2
    exit 1
  fi
  resolved_parent="$(realpath -m "$(dirname "$candidate_dir")")"
  resolved_tool_scratch="$(realpath -m "$tool_scratch")"
  if [ "$resolved_parent" != "$resolved_tool_scratch" ]; then
    echo "Refusing to reset candidate outside tool scratch: $candidate_dir" >&2
    exit 1
  fi
  if [ -L "$candidate_dir" ]; then
    echo "Refusing to reset symlinked candidate directory: $candidate_dir" >&2
    exit 1
  fi
  rm -rf -- "$candidate_dir"
  mkdir -p "$candidate_dir"
}

stop_tmux() {
  if tmux has-session -t "$tmux_session" 2>/dev/null; then
    tmux kill-session -t "$tmux_session" 2>/dev/null || true
  fi
}

stop_proxy() {
  if [ -n "$proxy_pid" ] && kill -0 "$proxy_pid" 2>/dev/null; then
    kill "$proxy_pid" 2>/dev/null || true
    for _ in {1..10}; do
      kill -0 "$proxy_pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$proxy_pid" 2>/dev/null; then
      kill -KILL "$proxy_pid" 2>/dev/null || true
    fi
    wait "$proxy_pid" 2>/dev/null || true
  fi
  proxy_pid=""
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  set +e
  stop_tmux
  stop_proxy
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

proxy_is_ready() {
  if { exec 9<>"/dev/tcp/127.0.0.1/$proxy_port"; } 2>/dev/null; then
    exec 9>&-
    exec 9<&-
    return 0
  fi
  return 1
}

start_proxy() {
  mitmdump \
    --listen-host 127.0.0.1 \
    --listen-port "$proxy_port" \
    --set flow_detail=0 \
    -s "$repo_root/grok/misc/scripts/mitm-capture-grok.py" \
    --set "grok_capture_out=$capture_file" \
    >"$proxy_log" 2>&1 &
  proxy_pid=$!

  local deadline=$((SECONDS + startup_timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      echo "Grok capture proxy exited during startup." >&2
      echo "Grok proxy diagnostics were retained locally and suppressed from CI logs." >&2
      return 1
    fi
    if proxy_is_ready; then
      if [ ! -f "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" ]; then
        echo "mitmproxy started but did not create its CA certificate." >&2
        return 1
      fi
      return 0
    fi
    sleep "$poll_interval"
  done

  echo "Timed out after ${startup_timeout}s waiting for the Grok capture proxy." >&2
  echo "Grok proxy diagnostics were retained locally and suppressed from CI logs." >&2
  return 1
}

capture_has_completed_marker() {
  local marker="$1"
  [ -s "$capture_file" ] || return 1
  jq -e -s --arg marker "$marker" '
    any(.[];
      .capture_marker == $marker and
      ((.response_status // 0) >= 200 and (.response_status // 0) < 300) and
      .response_complete == true and
      ((.response_markers // []) | index($marker)) != null
    )
  ' "$capture_file" >/dev/null 2>&1
}

capture_has_completed_session_title() {
  [ -s "$capture_file" ] || return 1
  jq -e -s '
    [
      .[]
      | (.request_body | fromjson?) as $body
      | select((($body.tools // []) | length) == 1)
      | select(($body.tools[0].name // $body.tools[0].type) == "session_title")
      | select(
          ((.response_status // 0) >= 200 and (.response_status // 0) < 300)
          and .response_complete == true
        )
    ]
    | length > 0
  ' "$capture_file" >/dev/null 2>&1
}

wait_for_completed_marker() {
  local marker="$1" label="$2" session_name="${3:-}"
  local deadline=$((SECONDS + response_timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if capture_has_completed_marker "$marker"; then
      return 0
    fi
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      echo "Grok capture proxy exited while waiting for $label." >&2
      echo "Grok proxy diagnostics were retained locally and suppressed from CI logs." >&2
      return 1
    fi
    if [ -n "$session_name" ] && ! tmux has-session -t "$session_name" 2>/dev/null; then
      echo "Grok interactive session exited before $label completed." >&2
      echo "Grok interactive diagnostics were suppressed from CI logs." >&2
      return 1
    fi
    sleep "$poll_interval"
  done

  echo "Timed out after ${response_timeout}s waiting for $label response evidence." >&2
  [ ! -s "$capture_file" ] || echo "Partial Grok capture metadata was suppressed from CI logs." >&2
  return 1
}

wait_for_completed_session_title() {
  local deadline=$((SECONDS + response_timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if capture_has_completed_session_title; then
      return 0
    fi
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      echo "Grok capture proxy exited while waiting for session-title evidence." >&2
      echo "Grok proxy diagnostics were retained locally and suppressed from CI logs." >&2
      return 1
    fi
    if ! tmux has-session -t "$tmux_session" 2>/dev/null; then
      echo "Grok interactive session exited before session-title capture completed." >&2
      echo "Grok interactive diagnostics were suppressed from CI logs." >&2
      return 1
    fi
    sleep "$poll_interval"
  done

  echo "Timed out after ${response_timeout}s waiting for a completed session-title response." >&2
  [ ! -s "$capture_file" ] || echo "Partial Grok session-title metadata was suppressed from CI logs." >&2
  return 1
}

wait_for_tmux_startup() {
  local stable_polls=0 last_pane="" pane="" deadline=$((SECONDS + startup_timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! tmux has-session -t "$tmux_session" 2>/dev/null; then
      echo "Grok interactive session exited during startup." >&2
      echo "Grok interactive diagnostics were suppressed from CI logs." >&2
      return 1
    fi
    pane="$(tmux capture-pane -p -t "$tmux_session:0.0" 2>/dev/null || true)"
    if [ -n "${pane//[[:space:]]/}" ] && [ "$pane" = "$last_pane" ]; then
      stable_polls=$((stable_polls + 1))
    else
      stable_polls=0
    fi
    if [ "$stable_polls" -ge 2 ]; then
      return 0
    fi
    last_pane="$pane"
    sleep "$poll_interval"
  done
  echo "Timed out after ${startup_timeout}s waiting for the Grok interactive session." >&2
  return 1
}

reset_candidate_dir
previous_mirror_revision="$(git -C "$repo_root/references/grok-build" rev-parse "${mirror_revision}^" 2>/dev/null || printf '%s' "$mirror_revision")"
node "$repo_root/.github/scripts/source-surface-inventory.cjs" \
  grok "$repo_root/references/grok-build" "$previous_mirror_revision" "$mirror_revision" \
  "$tool_scratch/source-surface-inventory.json" crates/codegen/xai-grok-shell
start_proxy

proxy_url="http://127.0.0.1:$proxy_port"
ca_file="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"

set +e
(
  cd "$work_dir"
  timeout --foreground --signal=TERM --kill-after=15s "${command_timeout}s" \
    env HTTPS_PROXY="$proxy_url" https_proxy="$proxy_url" NO_PROXY= no_proxy= \
    SSL_CERT_FILE="$ca_file" \
    "$grok_executable" -p "Reply exactly: $noninteractive_marker" --output-format json
) >"$noninteractive_stdout" 2>"$noninteractive_stderr"
noninteractive_status=$?
set -e
if [ "$noninteractive_status" -ne 0 ]; then
  echo "Grok non-interactive capture exited with status $noninteractive_status." >&2
  echo "Grok noninteractive diagnostics were suppressed from CI logs." >&2
  exit "$noninteractive_status"
fi
wait_for_completed_marker "$noninteractive_marker" "non-interactive marker"

printf -v interactive_command \
  'exec env HTTPS_PROXY=%q https_proxy=%q NO_PROXY=%q no_proxy=%q SSL_CERT_FILE=%q %q --always-approve' \
  "$proxy_url" "$proxy_url" '' '' "$ca_file" "$grok_executable"
tmux new-session -d -s "$tmux_session" -c "$work_dir" "$interactive_command"
printf -v pipe_command 'cat >> %q' "$interactive_log"
tmux pipe-pane -o -t "$tmux_session:0.0" "$pipe_command"
wait_for_tmux_startup
tmux send-keys -t "$tmux_session:0.0" -l -- "Reply exactly: $interactive_marker"
tmux send-keys -t "$tmux_session:0.0" Enter
wait_for_completed_marker "$interactive_marker" "interactive marker" "$tmux_session"
wait_for_completed_session_title

tmux send-keys -t "$tmux_session:0.0" C-c 2>/dev/null || true
sleep 1
stop_tmux
stop_proxy

CAPTURE_SCRATCH_DIR="$scratch_root" \
  CAPTURE_TARGET_VERSION="$target_version" \
  CAPTURE_SURFACE_INVENTORY="$tool_scratch/surface-observations.json" \
  timeout --foreground --signal=TERM --kill-after=10s "${extraction_timeout}s" \
  node "$repo_root/grok/misc/scripts/extract-grok-capture.cjs" \
  "$capture_file" "$candidate_dir"

echo "Grok capture complete: $candidate_dir"
echo "Redacted evidence retained at: $work_dir"
