#!/usr/bin/env bash
# Runs inside the provider image as `runner`. Seeds the target's credentials
# (author only), renders the goal, and runs the Claude Code driver headless.
#
# Mounts: /workspace (repo copy), /scratch (private run state), /trusted (read-only
# copy of the trusted scripts and specs).
# Env: ROLE (author|review), PROVIDER, ATTEMPT, AGENT_MODEL, AGENT_EFFORT, AGENT_TIMEOUT.
# Outputs: /scratch/out/<role>-<attempt>.{jsonl,result.json}. Transcripts stay private.

set -euo pipefail

role="${ROLE:?}"; provider="${PROVIDER:?}"; attempt="${ATTEMPT:-1}"
trusted=/trusted/.github/agentic
plan=/scratch/plan.json
out=/scratch/out
export EVIDENCE_DIR=/scratch/evidence
mkdir -p "$out" "$EVIDENCE_DIR"

version="$(jq -r '.new_version' "$plan")"
render() { sed -e "s|{{provider}}|$provider|g" -e "s|{{version}}|$version|g" "$1"; }

if [ "$role" = author ]; then
  scope="$(awk '/credential_scope:/ {print $2}' "$trusted/providers/$provider.yaml")"
  [ -n "$scope" ] && bash /trusted/.github/scripts/seed-credentials.sh "$scope" >/dev/null
fi

prompt="$(
  render "$trusted/$role.md"
  printf '\n## Provider spec\n\n```yaml\n%s\n```\n' "$(cat "$trusted/providers/$provider.yaml")"
  printf '\n## Release plan\n\n```json\n%s\n```\n' "$(jq . "$plan")"
  if [ -s /scratch/feedback.md ]; then
    printf '\n## Previous attempt was not accepted\n\nThe repository copy still holds that attempt; fix it.\n\n%s\n' \
      "$(cat /scratch/feedback.md)"
  fi
)"

args=(-p "$prompt" --model "${AGENT_MODEL:-claude-opus-5-5}" --effort "${AGENT_EFFORT:-medium}"
  --permission-mode bypassPermissions --output-format stream-json --verbose)
[ "$role" = review ] && args+=(--json-schema "$(cat "$trusted/review.schema.json")")

transcript="$out/$role-$attempt.jsonl"
status=0
timeout --kill-after=30s "${AGENT_TIMEOUT:-5400}" /opt/driver/claude "${args[@]}" \
  >"$transcript" 2>"$out/$role-$attempt.stderr" || status=$?

# Public logs get only run statistics; the transcript itself never leaves /scratch.
jq -c 'select(.type == "result")' "$transcript" | tail -n1 >"$out/$role-$attempt.result.json" || true
jq -r '"\(.subtype // "unknown") turns=\(.num_turns // "?") minutes=\(((.duration_ms // 0) / 60000) | floor) error=\(.is_error // "?")"' \
  "$out/$role-$attempt.result.json" 2>/dev/null || echo "no result (exit $status)"
exit "$status"
