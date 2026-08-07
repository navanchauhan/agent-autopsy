#!/usr/bin/env bash
# Seeds only the credential required by one capture worker. Values are decoded
# atomically and validated before they replace a CLI credential file.

set -euo pipefail

scope="${1:-all}"

validate_provider_json() {
  local var_name="$1" file="$2"
  case "$var_name" in
    CODEX_CHATGPT_AUTH_JSON)
      jq -e '
        .auth_mode == "chatgpt" and (.tokens | type == "object") and
        (.tokens.access_token | type == "string" and length >= 20) and
        (.tokens.refresh_token | type == "string" and length >= 20) and
        (.tokens.id_token | type == "string" and length >= 20) and
        (.tokens.account_id | type == "string" and length > 0) and
        (.last_refresh | type == "string" and length > 0)
      ' "$file" >/dev/null
      ;;
    CLAUDE_CODE_CREDENTIALS_JSON)
      jq -e '
        .claudeAiOauth | type == "object" and
        (.accessToken | type == "string" and length >= 20) and
        (.refreshToken | type == "string" and length >= 20) and
        (.expiresAt | type == "number") and
        (.scopes | type == "array" and all(.[]; type == "string"))
      ' "$file" >/dev/null
      ;;
    GROK_AUTH_JSON)
      jq -e '
        type == "object" and length > 0 and all(to_entries[];
          (.key | type == "string" and length > 0) and
          (.value | type == "object") and
          (.value.key | type == "string" and length >= 12) and
          (.value.auth_mode | IN("web_login", "grok", "oidc", "external", "api_key")) and
          (.value.create_time | type == "string" and length > 0) and
          (.value.user_id | type == "string"))
      ' "$file" >/dev/null
      ;;
    *) return 2 ;;
  esac
}

decode_json() {
  local var_name="$1" dest_path="$2" required="${3:-true}"
  local value="${!var_name:-}"
  if [ -z "$value" ]; then
    if [ "$required" = true ]; then
      echo "::warning::$var_name is not set; $scope cannot authenticate" >&2
      return 1
    fi
    return 0
  fi

  local dest_dir temp_file
  dest_dir="$(dirname "$dest_path")"
  mkdir -p "$dest_dir"
  temp_file="$(mktemp "$dest_dir/.credential.XXXXXX")"
  trap 'rm -f "$temp_file"' RETURN
  if ! printf '%s' "$value" | base64 -d >"$temp_file" ||
     ! jq -e 'type == "object"' "$temp_file" >/dev/null ||
     ! validate_provider_json "$var_name" "$temp_file"; then
    echo "::error::$var_name is not valid provider credential JSON" >&2
    return 1
  fi
  chmod 600 "$temp_file"
  mv -f "$temp_file" "$dest_path"
  trap - RETURN
  echo "Seeded $dest_path from $var_name"
}

decode_tar() {
  local var_name="$1" dest_dir="$2"; shift 2
  local allowed=("$@") value="${!var_name:-}"
  if [ -z "$value" ]; then
    echo "::warning::$var_name is not set; $scope cannot authenticate" >&2
    return 1
  fi

  local archive staging entry allowed_name ok entry_count
  local -a entries=()
  archive="$(mktemp)"
  staging="$(mktemp -d)"
  cleanup_tar() { rm -f "$archive"; rm -rf "$staging"; }
  trap cleanup_tar RETURN
  if ! printf '%s' "$value" | base64 -d >"$archive"; then
    echo "::error::$var_name is not valid base64" >&2
    return 1
  fi
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    if [[ "$entry" = /* || "$entry" == *".."* || "$entry" == */* ]]; then
      echo "::error::$var_name contains an unsafe archive path: $entry" >&2
      return 1
    fi
    ok=false
    for allowed_name in "${allowed[@]}"; do
      [ "$entry" = "$allowed_name" ] && ok=true
    done
    if [ "$ok" != true ]; then
      echo "::error::$var_name contains unexpected file: $entry" >&2
      return 1
    fi
    entries+=("$entry")
  done < <(tar -tf "$archive")
  if [ "${#entries[@]}" -ne "${#allowed[@]}" ]; then
    echo "::error::$var_name must contain exactly ${#allowed[@]} credential files" >&2
    return 1
  fi
  for allowed_name in "${allowed[@]}"; do
    entry_count=0
    for entry in "${entries[@]}"; do
      [ "$entry" = "$allowed_name" ] && entry_count=$((entry_count + 1))
    done
    if [ "$entry_count" -ne 1 ]; then
      echo "::error::$var_name must contain exactly one $allowed_name file" >&2
      return 1
    fi
  done
  tar -xf "$archive" -C "$staging"
  for allowed_name in "${allowed[@]}"; do
    if [ ! -f "$staging/$allowed_name" ] || [ -L "$staging/$allowed_name" ]; then
      echo "::error::$var_name did not contain a regular $allowed_name file" >&2
      return 1
    fi
    if [ ! -s "$staging/$allowed_name" ] ||
       LC_ALL=C grep -q '[[:cntrl:]]' "$staging/$allowed_name"; then
      echo "::error::$var_name contains invalid text in $allowed_name" >&2
      return 1
    fi
    if [ "$allowed_name" = installation_id ] &&
       ! [[ "$(tr -d '[:space:]' <"$staging/$allowed_name")" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
      echo "::error::$var_name contains an invalid installation_id" >&2
      return 1
    fi
  done
  mkdir -p "$dest_dir"
  for allowed_name in "${allowed[@]}"; do
    install -m 0600 "$staging/$allowed_name" "$dest_dir/$allowed_name"
  done
  cleanup_tar
  trap - RETURN
  echo "Seeded $dest_dir from $var_name"
}

seed_claude() {
  local has_auth=false version trusted_workspace
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    has_auth=true
    echo "CLAUDE_CODE_OAUTH_TOKEN is set for Claude print-mode requests"
  fi
  if [ -n "${CLAUDE_CODE_CREDENTIALS_JSON:-}" ]; then
    decode_json CLAUDE_CODE_CREDENTIALS_JSON "$HOME/.claude/.credentials.json"
    has_auth=true
  fi
  if [ "$has_auth" != true ]; then
    echo "::warning::Neither Claude credential secret is set" >&2
    return 1
  fi

  # The isolated CI home has no onboarding state. This does not contain auth;
  # it merely prevents the interactive PTY from opening first-run setup or a
  # workspace-trust dialog. The capture container always mounts this exact
  # trusted checkout path.
  version="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  trusted_workspace="${CLAUDE_TRUSTED_WORKSPACE:-/workspace}"
  jq -n --arg version "${version:-unknown}" --arg workspace "$trusted_workspace" \
    '{hasCompletedOnboarding:true,lastOnboardingVersion:$version,projects:{($workspace):{hasTrustDialogAccepted:true}}}' \
    >"$HOME/.claude.json"
  chmod 600 "$HOME/.claude.json"
}

case "$scope" in
  codex|codex-driver)
    decode_json CODEX_CHATGPT_AUTH_JSON "$HOME/.codex/auth.json"
    ;;
  claude-code)
    seed_claude
    ;;
  grok)
    decode_json GROK_AUTH_JSON "$HOME/.grok/auth.json"
    # Pin the exact artifact selected by the capture plan for the duration of
    # the run; the CLI must not swap itself after the preflight version check.
    printf '[cli]\nauto_update = false\n' >"$HOME/.grok/config.toml"
    chmod 600 "$HOME/.grok/config.toml"
    ;;
  antigravity)
    decode_tar ANTIGRAVITY_GEMINI_CREDS "$HOME/.gemini/antigravity-cli" \
      antigravity-oauth-token installation_id
    ;;
  all)
    seed_claude || true
    decode_json CODEX_CHATGPT_AUTH_JSON "$HOME/.codex/auth.json" false || true
    decode_json GROK_AUTH_JSON "$HOME/.grok/auth.json" false || true
    if [ -n "${ANTIGRAVITY_GEMINI_CREDS:-}" ]; then
      decode_tar ANTIGRAVITY_GEMINI_CREDS "$HOME/.gemini/antigravity-cli" \
        antigravity-oauth-token installation_id
    fi
    ;;
  *)
    echo "Usage: seed-credentials.sh {codex-driver|claude-code|grok|antigravity|all}" >&2
    exit 2
    ;;
esac
