#!/usr/bin/env bash
# Rewrites refreshed credential files back into GitHub Secrets after a run.
# Mirrors the exact pattern already used in navanchauhan/swiper's
# sync-trakt-movies.yml: a separate bootstrap PAT (REPO_SECRETS_PAT) is
# required because the default GITHUB_TOKEN cannot write repo secrets. If the
# PAT isn't set, this warns and continues rather than failing the run — same
# as swiper's "Persist rotated Trakt refresh token" step.

set -euo pipefail

repo="${GITHUB_REPOSITORY:-${REPO:-}}"
if [ -z "$repo" ]; then
  echo "::warning::rotate-secrets.sh: no repo (GITHUB_REPOSITORY/REPO) set; skipping all secret rotation"
  exit 0
fi

rotate_file() {
  local secret_name="$1" src_path="$2"
  if [ ! -f "$src_path" ]; then
    echo "::warning::$src_path does not exist; skipping rotation of $secret_name"
    return
  fi
  if [ -z "${REPO_SECRETS_PAT:-}" ]; then
    echo "::warning::REPO_SECRETS_PAT is not set. $secret_name may have refreshed during this run but cannot be persisted — manually update it before the next scheduled run, or it may go stale/expire."
    return
  fi
  base64 < "$src_path" | GH_TOKEN="$REPO_SECRETS_PAT" gh secret set "$secret_name" --repo "$repo"
  echo "Rotated $secret_name from $src_path"
}

rotate_tar() {
  local secret_name="$1"; shift
  local files=("$@")
  local existing=()
  local basenames=()
  for f in "${files[@]}"; do
    [ -f "$f" ] && existing+=("$f")
  done
  if [ "${#existing[@]}" -eq 0 ]; then
    echo "::warning::none of (${files[*]}) exist; skipping rotation of $secret_name"
    return
  fi
  if [ -z "${REPO_SECRETS_PAT:-}" ]; then
    echo "::warning::REPO_SECRETS_PAT is not set. $secret_name may have refreshed during this run but cannot be persisted — manually update it before the next scheduled run, or it may go stale/expire."
    return
  fi
  for f in "${existing[@]}"; do
    basenames+=("$(basename "$f")")
  done
  tar -cf - -C "$(dirname "${existing[0]}")" "${basenames[@]}" \
    | base64 | GH_TOKEN="$REPO_SECRETS_PAT" gh secret set "$secret_name" --repo "$repo"
  echo "Rotated $secret_name from (${existing[*]})"
}

rotate_file "CODEX_CHATGPT_AUTH_JSON" "$HOME/.codex/auth.json"
rotate_file "GROK_AUTH_JSON" "$HOME/.grok/auth.json"
rotate_tar "ANTIGRAVITY_GEMINI_CREDS" \
  "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" \
  "$HOME/.gemini/antigravity-cli/installation_id"

# CLAUDE_CODE_OAUTH_TOKEN is intentionally not rotated here: `claude setup-token`
# produces a static long-lived token, not a per-run refresh token.
