#!/usr/bin/env bash

set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
trusted_script_dir="${TRUSTED_SCRIPT_DIR:-$repo_root/.github/scripts}"
ready_file="${1:-$repo_root/.capture-scratch/ready-tools.json}"
review_file="${2:-$repo_root/.capture-scratch/review-result.json}"
summary_file="${3:-$repo_root/.capture-scratch/codex-summary.md}"
output_dir="${4:-$repo_root/driver-output}"
capture_retries_file="${5:-$repo_root/.capture-scratch/capture-retries.json}"
fingerprint_file="${CANDIDATE_FINGERPRINT_FILE:-$repo_root/.capture-scratch/candidate-tree.sha256}"
driver_input_manifest="${DRIVER_INPUT_MANIFEST:-$repo_root/.capture-scratch/driver-input.json}"

node "$trusted_script_dir/validate-refresh.cjs" "$ready_file" "$summary_file"
node "$trusted_script_dir/validate-review.cjs" "$ready_file" "$review_file"
DRIVER_INPUT_MANIFEST="$driver_input_manifest" node "$trusted_script_dir/prepare-driver-output.cjs" \
  "$ready_file" "$review_file" "$summary_file" "$output_dir" "$capture_retries_file"

if ! jq -e '.has_publishable' "$output_dir/result.json" >/dev/null; then
  : >"$output_dir/candidate.patch"
  exit 0
fi

[ -s "$fingerprint_file" ] || { echo "Trusted candidate fingerprint is missing." >&2; exit 1; }
expected_fingerprint="$(tr -d '[:space:]' <"$fingerprint_file")"
actual_fingerprint="$(bash "$trusted_script_dir/hash-candidate.sh" "$ready_file")"
[ "$expected_fingerprint" = "$actual_fingerprint" ] || {
  echo "Candidate changed after independent review." >&2
  exit 1
}

dirs=()
while IFS= read -r dir; do
  dirs+=("$dir")
done < <(jq -r '.[].dir' "$output_dir/changed-tools.json")
git -C "$repo_root" add -N -- "${dirs[@]}" CATALOG.md
git -C "$repo_root" diff --binary --full-index --no-ext-diff --no-renames HEAD -- "${dirs[@]}" CATALOG.md \
  >"$output_dir/candidate.patch"
if [ ! -s "$output_dir/candidate.patch" ]; then
  echo "Approved review produced no candidate patch." >&2
  exit 1
fi
