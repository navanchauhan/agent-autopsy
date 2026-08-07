#!/usr/bin/env bash
# Fixture-only regression coverage for credential seeding and persistence.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
seed_script="$repo_root/.github/scripts/seed-credentials.sh"
persist_script="$repo_root/.github/scripts/persist-credential.sh"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

fail() {
  echo "credential regression failure: $*" >&2
  exit 1
}

expect_failure() {
  local label="$1"
  shift
  if "$@" >"$test_root/failure.stdout" 2>"$test_root/failure.stderr"; then
    fail "$label unexpectedly succeeded"
  fi
}

encode() {
  printf '%s' "$1" | base64 -w0
}

assert_file_equals() {
  local expected="$1" actual="$2" label="$3"
  cmp -s "$expected" "$actual" || fail "$label changed unexpectedly"
}

codex_json='{"auth_mode":"chatgpt","tokens":{"access_token":"codex-access-token-000000","refresh_token":"codex-refresh-token-00000","id_token":"codex-identity-token-0000","account_id":"fixture-account"},"last_refresh":"2026-01-01T00:00:00Z"}'
claude_json='{"claudeAiOauth":{"accessToken":"claude-access-token-00000","refreshToken":"claude-refresh-token-0000","expiresAt":1893456000000,"scopes":["user:inference"]}}'
grok_json='{"fixture-account":{"key":"grok-key-0000000000","auth_mode":"web_login","create_time":"2026-01-01T00:00:00Z","user_id":"fixture-user"}}'
installation_id='12345678-1234-4abc-8def-1234567890ab'
antigravity_token='fixture-antigravity-token-value'

test_json_seed() {
  local scope="$1" variable="$2" json="$3" relative_path="$4"
  local home="$test_root/seed-$scope" destination="$test_root/seed-$scope/$relative_path"
  local original="$test_root/$scope-original.json"
  mkdir -p "$(dirname "$destination")"
  printf '%s' "$json" >"$original"

  env HOME="$home" "$variable=$(encode "$json")" \
    bash "$seed_script" "$scope" >"$test_root/$scope-seed.stdout"
  assert_file_equals "$original" "$destination" "$scope valid credential"

  cp "$destination" "$original"
  expect_failure "$scope invalid credential" \
    env HOME="$home" "$variable=$(encode '{"malformed":"credential"}')" \
    bash "$seed_script" "$scope"
  assert_file_equals "$original" "$destination" "$scope destination"
}

test_json_seed codex CODEX_CHATGPT_AUTH_JSON "$codex_json" .codex/auth.json
test_json_seed claude-code CLAUDE_CODE_CREDENTIALS_JSON "$claude_json" .claude/.credentials.json
test_json_seed grok GROK_AUTH_JSON "$grok_json" .grok/auth.json
grep -Fqx 'auto_update = false' "$test_root/seed-grok/.grok/config.toml" ||
  fail 'Grok auto-update was not disabled'

antigravity_fixture="$test_root/antigravity-fixture"
antigravity_home="$test_root/seed-antigravity"
antigravity_destination="$antigravity_home/.gemini/antigravity-cli"
mkdir -p "$antigravity_fixture" "$antigravity_destination"
printf '%s' "$antigravity_token" >"$antigravity_fixture/antigravity-oauth-token"
printf '%s\n' "$installation_id" >"$antigravity_fixture/installation_id"
tar -cf "$test_root/antigravity-valid.tar" -C "$antigravity_fixture" \
  antigravity-oauth-token installation_id
env HOME="$antigravity_home" \
  ANTIGRAVITY_GEMINI_CREDS="$(base64 -w0 <"$test_root/antigravity-valid.tar")" \
  bash "$seed_script" antigravity >"$test_root/antigravity-seed.stdout"
assert_file_equals "$antigravity_fixture/antigravity-oauth-token" \
  "$antigravity_destination/antigravity-oauth-token" 'Antigravity token'
assert_file_equals "$antigravity_fixture/installation_id" \
  "$antigravity_destination/installation_id" 'Antigravity installation ID'

cp "$antigravity_destination/antigravity-oauth-token" "$test_root/original-antigravity-token"
cp "$antigravity_destination/installation_id" "$test_root/original-installation-id"
printf '%s' 'replacement-token-must-not-land' >"$antigravity_fixture/antigravity-oauth-token"
printf '%s\n' 'not-a-uuid' >"$antigravity_fixture/installation_id"
tar -cf "$test_root/antigravity-bad-uuid.tar" -C "$antigravity_fixture" \
  antigravity-oauth-token installation_id
expect_failure 'Antigravity invalid UUID' env HOME="$antigravity_home" \
  ANTIGRAVITY_GEMINI_CREDS="$(base64 -w0 <"$test_root/antigravity-bad-uuid.tar")" \
  bash "$seed_script" antigravity
assert_file_equals "$test_root/original-antigravity-token" \
  "$antigravity_destination/antigravity-oauth-token" 'Antigravity token destination'
assert_file_equals "$test_root/original-installation-id" \
  "$antigravity_destination/installation_id" 'Antigravity installation destination'

printf '%s\n' 'unexpected' >"$antigravity_fixture/extra-file"
tar -cf "$test_root/antigravity-extra.tar" -C "$antigravity_fixture" \
  antigravity-oauth-token installation_id extra-file
expect_failure 'Antigravity extra archive member' env HOME="$antigravity_home" \
  ANTIGRAVITY_GEMINI_CREDS="$(base64 -w0 <"$test_root/antigravity-extra.tar")" \
  bash "$seed_script" antigravity
assert_file_equals "$test_root/original-antigravity-token" \
  "$antigravity_destination/antigravity-oauth-token" 'Antigravity token after extra member'
assert_file_equals "$test_root/original-installation-id" \
  "$antigravity_destination/installation_id" 'Antigravity installation after extra member'

tar -cf "$test_root/antigravity-duplicate.tar" -C "$antigravity_fixture" \
  antigravity-oauth-token installation_id antigravity-oauth-token
expect_failure 'Antigravity duplicate archive member' env HOME="$antigravity_home" \
  ANTIGRAVITY_GEMINI_CREDS="$(base64 -w0 <"$test_root/antigravity-duplicate.tar")" \
  bash "$seed_script" antigravity
assert_file_equals "$test_root/original-antigravity-token" \
  "$antigravity_destination/antigravity-oauth-token" 'Antigravity token after duplicate member'
assert_file_equals "$test_root/original-installation-id" \
  "$antigravity_destination/installation_id" 'Antigravity installation after duplicate member'

mock_bin="$test_root/mock-bin"
mkdir -p "$mock_bin"
cat >"$mock_bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail
: "${GH_ARGS_CAPTURE:?}"
: "${GH_STDIN_CAPTURE:?}"
printf '%s\n' "$@" >"$GH_ARGS_CAPTURE"
umask 077
cat >"$GH_STDIN_CAPTURE"
MOCK_GH
chmod 0700 "$mock_bin/gh"

assert_gh_call() {
  local secret_name="$1" cleartext_fixture="$2"
  local -a args=()
  mapfile -t args <"$test_root/gh-args"
  [ "${#args[@]}" -eq 7 ] || fail "$secret_name gh argument count was not seven"
  [ "${args[0]}" = secret ] && [ "${args[1]}" = set ] &&
    [ "${args[2]}" = "$secret_name" ] && [ "${args[3]}" = --env ] &&
    [ "${args[4]}" = agent-autopsy-capture ] && [ "${args[5]}" = --repo ] &&
    [ "${args[6]}" = fixture-owner/fixture-repo ] ||
    fail "$secret_name was not persisted to the expected environment"
  if grep -Fq "$cleartext_fixture" "$test_root/gh-args" ||
     grep -Fq "$(encode "$cleartext_fixture")" "$test_root/gh-args"; then
    fail "$secret_name credential material appeared in gh arguments"
  fi
}

run_persist() {
  local scope="$1" export_dir="$2"
  : >"$test_root/gh-args"
  : >"$test_root/gh-stdin"
  env -u CREDENTIAL_ENVIRONMENT \
    PATH="$mock_bin:$PATH" GH_TOKEN=fixture-management-token \
    GITHUB_REPOSITORY=fixture-owner/fixture-repo \
    GH_ARGS_CAPTURE="$test_root/gh-args" GH_STDIN_CAPTURE="$test_root/gh-stdin" \
    bash "$persist_script" "$scope" "$export_dir" >"$test_root/$scope-persist.stdout"
}

persist_dir="$test_root/persist"
mkdir -p "$persist_dir"
printf '%s' "$codex_json" >"$persist_dir/codex-auth.json"
run_persist codex-driver "$persist_dir"
assert_gh_call CODEX_CHATGPT_AUTH_JSON 'codex-refresh-token-00000'
base64 -d <"$test_root/gh-stdin" >"$test_root/persisted-codex.json"
assert_file_equals "$persist_dir/codex-auth.json" "$test_root/persisted-codex.json" \
  'persisted Codex credential'

printf '%s' "$claude_json" >"$persist_dir/claude-credentials.json"
run_persist claude-code "$persist_dir"
assert_gh_call CLAUDE_CODE_CREDENTIALS_JSON 'claude-refresh-token-0000'
base64 -d <"$test_root/gh-stdin" >"$test_root/persisted-claude.json"
assert_file_equals "$persist_dir/claude-credentials.json" "$test_root/persisted-claude.json" \
  'persisted Claude credential'

printf '%s' "$grok_json" >"$persist_dir/grok-auth.json"
run_persist grok "$persist_dir"
assert_gh_call GROK_AUTH_JSON 'grok-key-0000000000'
base64 -d <"$test_root/gh-stdin" >"$test_root/persisted-grok.json"
assert_file_equals "$persist_dir/grok-auth.json" "$test_root/persisted-grok.json" \
  'persisted Grok credential'

printf '%s' "$antigravity_token" >"$persist_dir/antigravity-oauth-token"
printf '%s\n' "$installation_id" >"$persist_dir/installation_id"
run_persist antigravity "$persist_dir"
assert_gh_call ANTIGRAVITY_GEMINI_CREDS "$antigravity_token"
base64 -d <"$test_root/gh-stdin" >"$test_root/persisted-antigravity.tar"
mapfile -t persisted_entries < <(tar -tf "$test_root/persisted-antigravity.tar")
[ "${#persisted_entries[@]}" -eq 2 ] &&
  [ "${persisted_entries[0]}" = antigravity-oauth-token ] &&
  [ "${persisted_entries[1]}" = installation_id ] ||
  fail 'persisted Antigravity archive did not contain exactly the expected files'
mkdir -p "$test_root/persisted-antigravity"
tar -xf "$test_root/persisted-antigravity.tar" -C "$test_root/persisted-antigravity"
assert_file_equals "$persist_dir/antigravity-oauth-token" \
  "$test_root/persisted-antigravity/antigravity-oauth-token" 'persisted Antigravity token'
assert_file_equals "$persist_dir/installation_id" \
  "$test_root/persisted-antigravity/installation_id" 'persisted Antigravity installation ID'

assert_invalid_json_persist() {
  local scope="$1" file="$2" label="$3"
  printf '%s' '{"malformed":"credential"}' >"$persist_dir/$file"
  : >"$test_root/gh-args"
  expect_failure "invalid $label persistence" env -u CREDENTIAL_ENVIRONMENT \
    PATH="$mock_bin:$PATH" GH_TOKEN=fixture-management-token \
    GITHUB_REPOSITORY=fixture-owner/fixture-repo \
    GH_ARGS_CAPTURE="$test_root/gh-args" GH_STDIN_CAPTURE="$test_root/gh-stdin" \
    bash "$persist_script" "$scope" "$persist_dir"
  [ ! -s "$test_root/gh-args" ] || fail "invalid $label credential invoked gh"
}

assert_invalid_json_persist codex-driver codex-auth.json Codex
assert_invalid_json_persist claude-code claude-credentials.json Claude
assert_invalid_json_persist grok grok-auth.json Grok

printf '%s\n' 'not-a-uuid' >"$persist_dir/installation_id"
: >"$test_root/gh-args"
expect_failure 'invalid Antigravity persistence' env -u CREDENTIAL_ENVIRONMENT \
  PATH="$mock_bin:$PATH" GH_TOKEN=fixture-management-token \
  GITHUB_REPOSITORY=fixture-owner/fixture-repo \
  GH_ARGS_CAPTURE="$test_root/gh-args" GH_STDIN_CAPTURE="$test_root/gh-stdin" \
  bash "$persist_script" antigravity "$persist_dir"
[ ! -s "$test_root/gh-args" ] || fail 'invalid Antigravity credential invoked gh'

echo 'Credential seed and persistence fixture tests passed.'
