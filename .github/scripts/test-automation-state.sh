#!/usr/bin/env bash

# Exercise the durable state branch using only isolated local repositories. No
# command in this fixture can reach or mutate the checkout's configured origin.

set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
restore_source="$source_root/.github/scripts/restore-automation-state.sh"
persist_source="$source_root/.github/scripts/persist-automation-state.sh"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/agent-autopsy-state-test.XXXXXX")"
origin="$fixture_root/origin.git"
state_ref='refs/heads/automation/release-state'

cleanup() {
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT

fail() {
  echo "automation-state regression test failed: $*" >&2
  exit 1
}

make_repo() {
  local name="$1"
  local repo="$fixture_root/$name"
  git init --quiet "$repo"
  git -C "$repo" remote add origin "$origin"
  mkdir -p "$repo/.github/scripts"
  install -m 0755 "$restore_source" "$repo/.github/scripts/restore-automation-state.sh"
  install -m 0755 "$persist_source" "$repo/.github/scripts/persist-automation-state.sh"
  printf '%s\n' "$repo"
}

push_tree() {
  local repo="$1"
  local tree="$2"
  local commit
  commit="$(
    printf '%s\n' 'Install automation-state fixture tree' |
      env \
        GIT_AUTHOR_NAME='agent-autopsy fixture' \
        GIT_AUTHOR_EMAIL='fixture@example.invalid' \
        GIT_COMMITTER_NAME='agent-autopsy fixture' \
        GIT_COMMITTER_EMAIL='fixture@example.invalid' \
        git -C "$repo" commit-tree "$tree"
  )"
  git -C "$repo" push --quiet --force origin "$commit:$state_ref"
}

expect_restore_failure_preserves_state() {
  local name="$1"
  local expected_message="$2"
  local repo state_dir before_ledger before_recapture stderr_file status
  repo="$(make_repo "$name")"
  state_dir="$repo/state"
  before_ledger="$fixture_root/$name-before-ledger.json"
  before_recapture="$fixture_root/$name-before-recapture.json"
  stderr_file="$fixture_root/$name.stderr"
  mkdir -p "$state_dir"
  printf '%s\n' '{"local":"ledger sentinel"}' >"$state_dir/release-ledger.json"
  printf '%s\n' '{"local":"recapture sentinel"}' >"$state_dir/recapture-state.json"
  cp "$state_dir/release-ledger.json" "$before_ledger"
  cp "$state_dir/recapture-state.json" "$before_recapture"

  set +e
  AUTOMATION_STATE_DIR="$state_dir" \
    bash "$repo/.github/scripts/restore-automation-state.sh" \
    >"$fixture_root/$name.stdout" 2>"$stderr_file"
  status=$?
  set -e

  [ "$status" -ne 0 ] || fail "$name restore unexpectedly succeeded"
  grep -F "$expected_message" "$stderr_file" >/dev/null || \
    fail "$name restore did not report the expected failure"
  cmp -s "$before_ledger" "$state_dir/release-ledger.json" || \
    fail "$name restore replaced the local ledger before failing"
  cmp -s "$before_recapture" "$state_dir/recapture-state.json" || \
    fail "$name restore replaced the local recapture state before failing"
}

git init --quiet --bare "$origin"

# With no durable branch, restore initializes the exact empty schema locally and
# does not create a remote branch as a side effect.
first_repo="$(make_repo first)"
first_state="$first_repo/state"
expected_ledger="$fixture_root/expected-empty-ledger.json"
expected_recapture="$fixture_root/expected-empty-recapture.json"
printf '%s\n' \
  '{"schema_version":1,"queues":{"codex":[],"claude-code":[],"grok":[],"antigravity":[]}}' \
  >"$expected_ledger"
printf '%s\n' '{"schema_version":1,"tools":{}}' >"$expected_recapture"
AUTOMATION_STATE_DIR="$first_state" \
  bash "$first_repo/.github/scripts/restore-automation-state.sh"
cmp -s "$expected_ledger" "$first_state/release-ledger.json" || \
  fail 'first restore did not initialize the exact empty release ledger'
cmp -s "$expected_recapture" "$first_state/recapture-state.json" || \
  fail 'first restore did not initialize the exact empty recapture state'
if git --git-dir="$origin" show-ref --verify --quiet "$state_ref"; then
  fail 'restore created the durable branch before persist'
fi

# Persist deliberately formatted JSON and verify that both the remote blobs and
# a fresh restore preserve every byte, including whitespace and the final LF.
custom_ledger="$fixture_root/custom-ledger.json"
custom_recapture="$fixture_root/custom-recapture.json"
printf '%s\n' \
  '{' \
  '  "schema_version": 1,' \
  '  "queues": {"codex": [], "claude-code": [], "grok": [], "antigravity": []}' \
  '}' >"$custom_ledger"
printf '%s\n' \
  '{' \
  '  "schema_version": 1,' \
  '  "tools": {}' \
  '}' >"$custom_recapture"
cp "$custom_ledger" "$first_state/release-ledger.json"
cp "$custom_recapture" "$first_state/recapture-state.json"
AUTOMATION_STATE_DIR="$first_state" \
  bash "$first_repo/.github/scripts/persist-automation-state.sh" \
  >"$fixture_root/first-persist.stdout"

remote_ledger="$fixture_root/remote-ledger.json"
remote_recapture="$fixture_root/remote-recapture.json"
git --git-dir="$origin" show "$state_ref:release-ledger.json" >"$remote_ledger"
git --git-dir="$origin" show "$state_ref:recapture-state.json" >"$remote_recapture"
cmp -s "$custom_ledger" "$remote_ledger" || fail 'persist changed release-ledger.json bytes'
cmp -s "$custom_recapture" "$remote_recapture" || fail 'persist changed recapture-state.json bytes'

second_repo="$(make_repo second)"
second_state="$second_repo/state"
AUTOMATION_STATE_DIR="$second_state" \
  bash "$second_repo/.github/scripts/restore-automation-state.sh"
cmp -s "$custom_ledger" "$second_state/release-ledger.json" || \
  fail 'round-trip restore changed release-ledger.json bytes'
cmp -s "$custom_recapture" "$second_state/recapture-state.json" || \
  fail 'round-trip restore changed recapture-state.json bytes'

# Persisting identical bytes is a true early stop: it creates no commit and does
# not rewrite the remote branch.
before_idempotent="$(git --git-dir="$origin" rev-parse "$state_ref^{commit}")"
AUTOMATION_STATE_DIR="$second_state" \
  bash "$second_repo/.github/scripts/persist-automation-state.sh" \
  >"$fixture_root/idempotent-persist.stdout"
after_idempotent="$(git --git-dir="$origin" rev-parse "$state_ref^{commit}")"
[ "$before_idempotent" = "$after_idempotent" ] || fail 'idempotent persist created a commit'
grep -F 'Durable automation state is already current.' \
  "$fixture_root/idempotent-persist.stdout" >/dev/null || \
  fail 'idempotent persist did not take its early-stop path'

ledger_blob="$(git -C "$first_repo" hash-object -w "$custom_ledger")"
recapture_blob="$(git -C "$first_repo" hash-object -w "$custom_recapture")"

# A branch missing either required root blob must fail without mixing remote and
# local generations.
missing_tree="$(
  printf '100644 blob %s\trecapture-state.json\n' "$recapture_blob" |
    git -C "$first_repo" mktree
)"
push_tree "$first_repo" "$missing_tree"
expect_restore_failure_preserves_state \
  missing-entry 'Automation state branch has an invalid release-ledger.json entry.'

# Executable, symlink, tree, and submodule modes are all rejected; exercise the
# executable case while also proving the first valid blob is not installed.
invalid_mode_tree="$(
  {
    printf '100755 blob %s\trecapture-state.json\n' "$recapture_blob"
    printf '100644 blob %s\trelease-ledger.json\n' "$ledger_blob"
  } | git -C "$first_repo" mktree
)"
push_tree "$first_repo" "$invalid_mode_tree"
expect_restore_failure_preserves_state \
  invalid-mode 'Automation state branch has an invalid recapture-state.json entry.'

# Correct tree modes are insufficient when a blob is corrupted JSON.
invalid_json="$fixture_root/invalid.json"
printf '%s\n' '{not-json' >"$invalid_json"
invalid_json_blob="$(git -C "$first_repo" hash-object -w "$invalid_json")"
invalid_json_tree="$(
  {
    printf '100644 blob %s\trecapture-state.json\n' "$invalid_json_blob"
    printf '100644 blob %s\trelease-ledger.json\n' "$ledger_blob"
  } | git -C "$first_repo" mktree
)"
push_tree "$first_repo" "$invalid_json_tree"
expect_restore_failure_preserves_state \
  invalid-json 'Automation state branch has invalid JSON in recapture-state.json.'

echo 'automation-state branch integration tests passed'
