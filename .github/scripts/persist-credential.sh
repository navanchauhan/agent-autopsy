#!/usr/bin/env bash
# Host-side credential persistence. The workflow copies this script into
# RUNNER_TEMP before any provider or Codex binary executes, then runs that
# immutable copy with the repository-secret-management token.

set -euo pipefail

scope="${1:?scope is required}"
export_dir="${2:?credential export directory is required}"
result_path="${3:-}"
max_bytes=2097152
credential_environment="${CREDENTIAL_ENVIRONMENT:-agent-autopsy-capture}"

if ! [[ "$credential_environment" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]]; then
  echo "Invalid credential environment name." >&2
  exit 2
fi

valid_regular_file() {
  local file="$1"
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c %s "$file")" -gt 0 ] &&
    [ "$(stat -c %s "$file")" -le "$max_bytes" ]
}

valid_json_file() {
  valid_regular_file "$1" && jq -e 'type == "object"' "$1" >/dev/null
}

valid_claude_credentials() {
  valid_json_file "$1" && jq -e '
    .claudeAiOauth | type == "object" and
    (.accessToken | type == "string" and length >= 20) and
    (.refreshToken | type == "string" and length >= 20) and
    (.expiresAt | type == "number") and
    (.scopes | type == "array" and all(.[]; type == "string"))
  ' "$1" >/dev/null
}

valid_grok_credentials() {
  valid_json_file "$1" && jq -e '
    length > 0 and all(to_entries[];
      (.key | type == "string" and length > 0) and
      (.value | type == "object") and
      (.value.key | type == "string" and length >= 12) and
      (.value.auth_mode | IN("web_login", "grok", "oidc", "external", "api_key")) and
      (.value.create_time | type == "string" and length > 0) and
      (.value.user_id | type == "string"))
  ' "$1" >/dev/null
}

valid_codex_credentials() {
  valid_json_file "$1" && jq -e '
    .auth_mode == "chatgpt" and
    (.tokens | type == "object") and
    (.tokens.access_token | type == "string" and length >= 20) and
    (.tokens.refresh_token | type == "string" and length >= 20) and
    (.tokens.id_token | type == "string" and length >= 20) and
    (.tokens.account_id | type == "string" and length > 0) and
    (.last_refresh | type == "string" and length > 0)
  ' "$1" >/dev/null
}

valid_opaque_text() {
  local file="$1"
  valid_regular_file "$file" && LC_ALL=C grep -q '[^[:space:]]' "$file" &&
    ! LC_ALL=C grep -q '[[:cntrl:]]' "$file"
}

store_file() {
  local secret_name="$1" file="$2"
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] &&
    base64 -w0 <"$file" | gh secret set "$secret_name" \
      --env "$credential_environment" --repo "$GITHUB_REPOSITORY"
}

persist() {
  case "$scope" in
    claude-code)
      local credentials="$export_dir/claude-credentials.json"
      if [ ! -e "$credentials" ]; then
        echo 'Claude used its static setup token; no rotating credential cache was emitted.'
        return 0
      fi
      valid_claude_credentials "$credentials" && store_file CLAUDE_CODE_CREDENTIALS_JSON "$credentials"
      ;;
    grok)
      local auth="$export_dir/grok-auth.json"
      valid_grok_credentials "$auth" && store_file GROK_AUTH_JSON "$auth"
      ;;
    antigravity)
      local token="$export_dir/antigravity-oauth-token"
      local installation="$export_dir/installation_id"
      local archive
      archive="$(mktemp)"
      if valid_opaque_text "$token" && valid_opaque_text "$installation" &&
         [[ "$(tr -d '[:space:]' <"$installation")" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]] &&
         [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] &&
         tar -cf "$archive" -C "$export_dir" antigravity-oauth-token installation_id &&
         base64 -w0 <"$archive" | gh secret set ANTIGRAVITY_GEMINI_CREDS \
           --env "$credential_environment" --repo "$GITHUB_REPOSITORY"; then
        rm -f -- "$archive"
        return 0
      fi
      rm -f -- "$archive"
      return 1
      ;;
    codex-driver)
      local auth="$export_dir/codex-auth.json"
      valid_codex_credentials "$auth" && store_file CODEX_CHATGPT_AUTH_JSON "$auth"
      ;;
    *)
      echo "Unsupported credential scope: $scope" >&2
      return 2
      ;;
  esac
}

if persist; then
  echo "$scope credential persistence is complete for this run."
  [ -n "${GITHUB_OUTPUT:-}" ] && echo 'rotation_ok=true' >>"$GITHUB_OUTPUT"
  exit 0
fi

message="$scope credentials were not safely persisted for the next run."
echo "::warning::$message" >&2
[ -n "${GITHUB_OUTPUT:-}" ] && echo 'rotation_ok=false' >>"$GITHUB_OUTPUT"

# Provider capture workers degrade to a structured retry so other providers
# can still publish. Codex-driver persistence is required and exits nonzero.
if [ -n "$result_path" ]; then
  status="$(jq -r '.status // "missing"' "$result_path" 2>/dev/null || printf missing)"
  if [ "$status" = captured ]; then
    temp_result="$(mktemp "$(dirname "$result_path")/.result.XXXXXX")"
    jq --arg message "$message" '.status="retry_capture" | .message=$message' \
      "$result_path" >"$temp_result"
    mv -f "$temp_result" "$result_path"
  fi
  exit 0
fi
exit 1
