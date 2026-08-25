#!/usr/bin/env bash
# Regression tests for the Claude session-title detector.
#
# Claude Code 2.1.234 reworded the session-title system prompt. The detector
# matched the old wording literally, so it stopped matching, the capture waited
# out its full timeout on every run, and the archive stalled at 2.1.233 for
# twelve releases while reporting only a generic incomplete capture.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
capture_script="$script_dir/capture-claude-code.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

# Source only the marker list and the detector, so the test exercises the real
# function rather than a copy of its jq program.
fragment="$work_dir/detector.sh"
sed -n '/^session_title_prompt_markers=(/,/^}/p' "$capture_script" >"$fragment"
if ! grep -q '^trace_has_session_title()' "$fragment"; then
  echo "FAIL: could not extract trace_has_session_title from capture-claude-code.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$fragment"

failures=0

record() {
  local name="$1" system="$2" tools="$3"
  local file="$work_dir/$name.json"
  jq -n --arg system "$system" --argjson tools "$tools" \
    '{request: {body: ({system: $system, tools: $tools, stream: false} | tojson)},
      response: {ok: true, completed: true, error_event: false, status: 200}}' >"$file"
  printf '%s' "$file"
}

expect() {
  local label="$1" file="$2" want="$3"
  if trace_has_session_title "$file"; then got=match; else got=no-match; fi
  if [ "$got" = "$want" ]; then
    echo "ok: $label ($got)"
  else
    echo "FAIL: $label expected $want, got $got" >&2
    failures=$((failures + 1))
  fi
}

# Both shipped wordings must be recognized: the pipeline replays one release at a
# time, so it still has to capture releases that predate the rewrite.
expect "2.1.233 wording is recognized" \
  "$(record old 'Generate a concise, sentence-case title (3-7 words) for this session.' '[]')" match
expect "2.1.234 wording is recognized" \
  "$(record new 'You are naming a coding session so the user can pick it out of a list.' '[]')" match

# A session-title request carries no tools; an ordinary turn does.
expect "an ordinary request is not a session title" \
  "$(record other 'You are Claude Code, an agentic coding tool.' '[]')" no-match
expect "a matching prompt with tools is not a session title" \
  "$(record tooled 'You are naming a coding session.' '[{"name":"Bash"}]')" no-match

# An unsuccessful response must never satisfy the wait.
failed_file="$work_dir/failed.json"
jq -n '{request: {body: ({system: "You are naming a coding session.", tools: [], stream: false} | tojson)},
        response: {ok: false, completed: true, error_event: true, status: 500}}' >"$failed_file"
expect "a failed response is not a successful capture" "$failed_file" no-match

# Every marker in the list must correspond to a real shipped prompt. This is the
# check that would have caught the 2.1.234 rewrite.
if [ "${#session_title_prompt_markers[@]}" -lt 2 ]; then
  echo "FAIL: expected the marker list to cover both known wordings" >&2
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures Claude session-title test(s) failed" >&2
  exit 1
fi
echo "Claude session-title detector tests passed"
