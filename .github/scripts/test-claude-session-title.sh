#!/usr/bin/env bash
# Regression tests for the structural Claude session-title detector.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
capture_script="$script_dir/capture-claude-code.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

# Source only the detector, so the test exercises the real
# function rather than a copy of its jq program.
fragment="$work_dir/detector.sh"
sed -n '/^trace_record_matches()/,/^}/p' "$capture_script" >"$fragment"
sed -n '/^trace_has_session_title()/,/^}/p' "$capture_script" >>"$fragment"
if ! grep -q '^trace_has_session_title()' "$fragment"; then
  echo "FAIL: could not extract trace_has_session_title from capture-claude-code.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$fragment"

failures=0

record() {
  local name="$1" system="$2" tools="$3" message="${4:-CLAUDE_INTERACTIVE_TRACE_OK}"
  local file="$work_dir/$name.json"
  jq -n --arg system "$system" --argjson tools "$tools" --arg message "$message" \
    '{request: {body: ({system: $system, tools: $tools, messages:[{role:"user",content:$message}], stream: false} | tojson)},
      response: {ok: true, completed: true, error_event: false, status: 200}}' >"$file"
  printf '%s' "$file"
}

expect() {
  local label="$1" file="$2" want="$3"
  if trace_has_session_title "$file" CLAUDE_INTERACTIVE_TRACE_OK; then got=match; else got=no-match; fi
  if [ "$got" = "$want" ]; then
    echo "ok: $label ($got)"
  else
    echo "FAIL: $label expected $want, got $got" >&2
    failures=$((failures + 1))
  fi
}

# Product wording is not part of the classification contract.
expect "old wording is recognized structurally" \
  "$(record old 'Generate a concise, sentence-case title (3-7 words) for this session.' '[]')" match
expect "new wording is recognized structurally" \
  "$(record new 'You are naming a coding session so the user can pick it out of a list.' '[]')" match
expect "an unseen wording is recognized structurally" \
  "$(record unseen 'Summarize this transcript as JSON.' '[]')" match

# A session-title request carries the captured session marker and no tools.
expect "an ordinary request is not a session title" \
  "$(record other 'You are Claude Code, an agentic coding tool.' '[]' 'ordinary user request')" no-match
expect "a matching prompt with tools is not a session title" \
  "$(record tooled 'You are naming a coding session.' '[{"name":"Bash"}]')" no-match

# A successful session-title request contains the interactive marker in its
# transcript. It must not satisfy the interactive agent-response wait.
session_file="$(record base-confuser 'Title this session.' '[]')"
if trace_record_matches "$session_file" CLAUDE_INTERACTIVE_TRACE_OK; then
  echo "FAIL: session-title request satisfied the interactive agent wait" >&2
  failures=$((failures + 1))
else
  echo "ok: session-title request cannot satisfy the interactive agent wait (no-match)"
fi

# An unsuccessful response must never satisfy the wait.
failed_file="$work_dir/failed.json"
jq -n '{request: {body: ({system: "You are naming a coding session.", tools: [], messages:[{role:"user",content:"CLAUDE_INTERACTIVE_TRACE_OK"}], stream: false} | tojson)},
        response: {ok: false, completed: true, error_event: true, status: 500}}' >"$failed_file"
expect "a failed response is not a successful capture" "$failed_file" no-match

if [ "$failures" -ne 0 ]; then
  echo "$failures Claude session-title test(s) failed" >&2
  exit 1
fi
echo "Claude session-title detector tests passed"
