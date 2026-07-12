#!/usr/bin/env bash
# Seeds each CLI's auth state from GitHub Secrets before a daily-refresh run.
# Never echoes decoded credential contents anywhere.
#
# Expects (as env vars, populated by the workflow from `secrets.*`):
#   CLAUDE_CODE_OAUTH_TOKEN   - static long-lived token from `claude setup-token`,
#                               used directly as an env var by the claude binary;
#                               nothing to write to disk for this one.
#   CODEX_CHATGPT_AUTH_JSON   - base64 of a fresh ~/.codex/auth.json (ChatGPT-session mode)
#   GROK_AUTH_JSON            - base64 of a fresh ~/.grok/auth.json
#   ANTIGRAVITY_GEMINI_CREDS  - base64 of a tar containing antigravity-oauth-token and
#                               installation_id for ~/.gemini/antigravity-cli (confirmed
#                               via a fresh container login — NOT ~/.gemini/oauth_creds.json,
#                               which turned out to belong to a separate Gemini CLI install)

set -euo pipefail

seed_file() {
  local var_name="$1" dest_path="$2"
  local value="${!var_name:-}"
  if [ -z "$value" ]; then
    echo "::warning::$var_name is not set; skipping $dest_path (that tool's capture will be skipped this run)"
    return 1
  fi
  mkdir -p "$(dirname "$dest_path")"
  printf '%s' "$value" | base64 -d > "$dest_path"
  chmod 600 "$dest_path"
  echo "Seeded $dest_path from $var_name"
}

seed_tar() {
  local var_name="$1" dest_dir="$2"
  local value="${!var_name:-}"
  if [ -z "$value" ]; then
    echo "::warning::$var_name is not set; skipping $dest_dir (that tool's capture will be skipped this run)"
    return 1
  fi
  mkdir -p "$dest_dir"
  printf '%s' "$value" | base64 -d | tar -xf - -C "$dest_dir"
  chmod 600 "$dest_dir"/* 2>/dev/null || true
  echo "Seeded $dest_dir from $var_name"
}

if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "CLAUDE_CODE_OAUTH_TOKEN is set (used directly as an env var, nothing written to disk)"
else
  echo "::warning::CLAUDE_CODE_OAUTH_TOKEN is not set; claude-code capture will be skipped this run"
fi

seed_file CODEX_CHATGPT_AUTH_JSON "$HOME/.codex/auth.json" || true
seed_file GROK_AUTH_JSON "$HOME/.grok/auth.json" || true
seed_tar ANTIGRAVITY_GEMINI_CREDS "$HOME/.gemini/antigravity-cli" || true
