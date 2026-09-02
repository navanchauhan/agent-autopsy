#!/usr/bin/env bash
# Executes one deterministic provider capture and always emits a structured
# result. Transient auth/capture gaps become retry_capture instead of consuming
# Codex tokens or blocking independent tools.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
output_root="${CAPTURE_OUTPUT_DIR:-$repo_root/capture-output}"
tool_json="${TOOL_JSON:?TOOL_JSON must contain one capture-plan entry}"

tool="$(jq -er '.tool' <<<"$tool_json")"
target_version="$(jq -er '.new_version' <<<"$tool_json")"
contract_hash="$(jq -er '.capture_contract_hash' <<<"$tool_json")"
plan_hash="$(jq -er '.plan_hash' <<<"$tool_json")"
tool_scratch="$scratch_root/$tool"
tool_output="$output_root/$tool"
mkdir -p "$tool_scratch" "$tool_output"
printf '%s\n' "$tool_json" | jq -e '[.]' >"$scratch_root/changed-tools.json"
export CHANGED_TOOLS_FILE="$scratch_root/changed-tools.json"

write_result() {
  local status="$1" message="$2"
  jq -n \
    --arg tool "$tool" \
    --arg target_version "$target_version" \
    --arg status "$status" \
    --arg message "$message" \
    --arg capture_contract_hash "$contract_hash" \
    --arg plan_hash "$plan_hash" \
    '{tool:$tool,target_version:$target_version,status:$status,message:$message,capture_contract_hash:$capture_contract_hash,plan_hash:$plan_hash}' \
    >"$tool_output/result.json"
}

export_refreshed_credential() {
  local export_dir="${CREDENTIAL_EXPORT_DIR:-}"
  [ -n "$export_dir" ] || return 0
  mkdir -p "$export_dir"
  case "$tool" in
    claude-code)
      if [ -s "$HOME/.claude/.credentials.json" ]; then
        install -m 0600 "$HOME/.claude/.credentials.json" "$export_dir/claude-credentials.json"
      fi
      ;;
    grok)
      [ -s "$HOME/.grok/auth.json" ] && \
        install -m 0600 "$HOME/.grok/auth.json" "$export_dir/grok-auth.json"
      ;;
    antigravity)
      local source_dir="$HOME/.gemini/antigravity-cli" name
      for name in antigravity-oauth-token installation_id; do
        [ -s "$source_dir/$name" ] && install -m 0600 "$source_dir/$name" "$export_dir/$name"
      done
      ;;
  esac
}

installed_version() {
  case "$tool" in
    claude-code) claude --version ;;
    grok) grok --version ;;
    antigravity) agy --version ;;
    codex) printf '%s\n' "$target_version" ;;
    qwen-code) printf '%s\n' "$target_version" ;;
    *) return 2 ;;
  esac | grep -oE '[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?' | head -n1
}

write_artifact_attestation() {
  local binary expected observed artifact_url
  case "$tool" in
    claude-code) binary="$(command -v claude)" ;;
    grok) binary="$(command -v grok)" ;;
    *) return 0 ;;
  esac

  expected="$(jq -er '.artifact_sha256 | select(test("^[0-9a-f]{64}$"))' <<<"$tool_json")" || return 1
  artifact_url="$(jq -er '.artifact_url | select(length > 0)' <<<"$tool_json")" || return 1
  observed="$(sha256sum -- "$binary" | cut -d' ' -f1)"
  [ "$observed" = "$expected" ] || return 1

  jq -n \
    --arg tool "$tool" \
    --arg version "$target_version" \
    --arg artifact_url "$artifact_url" \
    --arg expected_digest "$expected" \
    --arg observed_digest "$observed" \
    '{tool:$tool,version:$version,artifact_url:$artifact_url,digest_algorithm:"sha256",expected_digest:$expected_digest,observed_digest:$observed_digest,verified:($expected_digest == $observed_digest)}' \
    >"$tool_scratch/artifact-attestation.json"
}

actual_version="$(installed_version || true)"
if [ "$actual_version" != "$target_version" ]; then
  write_result retry_capture "Pinned binary mismatch: expected $target_version, found ${actual_version:-unknown}."
  echo "::warning::$tool capture deferred because the image did not contain the planned version" >&2
  exit 0
fi

if ! write_artifact_attestation; then
  write_result security_error "The installed $tool binary did not match the pinned artifact digest."
  echo "::error::$tool installed artifact failed its digest attestation" >&2
  exit 1
fi

if [ "$tool" != "codex" ] && [ "$tool" != "qwen-code" ]; then
  if ! bash "$repo_root/.github/scripts/seed-credentials.sh" "$tool"; then
    write_result retry_capture "The isolated $tool credential could not be seeded."
    echo "::warning::$tool capture deferred because its isolated credential was unavailable" >&2
    exit 0
  fi
  trap 'export_refreshed_credential || echo "::warning::$tool credential export failed" >&2' EXIT
fi

capture_status=0
capture_message="Capture completed for $target_version."
case "$tool" in
  codex)
    if [ "${SOURCE_ALREADY_SYNCED:-0}" != 1 ] && \
       ! bash "$repo_root/.github/scripts/sync-codex-reference.sh"; then
      capture_status=1
      capture_message="Exact Codex source tag could not be synchronized."
    else
      old_revision="$(jq -er '.old_revision' <<<"$tool_json")"
      new_revision="$(jq -er '.new_revision' <<<"$tool_json")"
      {
        echo '# Full release diff summary'
        git -C "$repo_root/references/codex" diff --shortstat "$old_revision" "$new_revision"
        echo
        echo '# Likely model-facing source paths (navigation index only)'
        git -C "$repo_root/references/codex" diff --name-status "$old_revision" "$new_revision" \
          | grep -Ei '(prompt|instruction|model|tool|guardian|collab|realtime|compact|review|personality|message|plugin|skill|permission|sandbox|agent)' \
          || true
      } >"$tool_scratch/source-changes.txt"
      jq -n --arg old "$old_revision" --arg new "$new_revision" \
        '{old_revision:$old,new_revision:$new}' >"$tool_scratch/source-revisions.json"
      # Locate the source file behind each tracked artifact deterministically, so
      # the author has a named, bounded read list instead of only a path index.
      node "$repo_root/.github/scripts/codex-artifact-map.cjs" \
        "$repo_root/references/codex" "$old_revision" "$new_revision" \
        "$repo_root/codex" "$tool_scratch/artifact-source-map.json" codex-rs
      node "$repo_root/.github/scripts/source-surface-inventory.cjs" \
        codex "$repo_root/references/codex" "$old_revision" "$new_revision" \
        "$tool_scratch/source-surface-inventory.json" codex-rs
    fi
    ;;
  qwen-code)
    if { [ "${SOURCE_ALREADY_SYNCED:-0}" != 1 ] && \
         ! bash "$repo_root/.github/scripts/sync-qwen-code-reference.sh"; } || \
       ! bash "$repo_root/.github/scripts/capture-qwen-code.sh"; then
      capture_status=1
      capture_message="Exact Qwen Code source could not be synchronized or indexed."
    fi
    ;;
  claude-code)
    if ! bash "$repo_root/.github/scripts/capture-claude-code.sh"; then
      capture_status=1
      capture_message="Claude capture was incomplete; retry after authentication or transport recovers."
    fi
    ;;
  grok)
    if { [ "${SOURCE_ALREADY_SYNCED:-0}" != 1 ] && \
         ! bash "$repo_root/.github/scripts/sync-grok-reference.sh"; } || \
       ! bash "$repo_root/.github/scripts/capture-grok.sh"; then
      capture_status=1
      capture_message="Grok source or live capture was incomplete; retry later."
    fi
    ;;
  antigravity)
    if ! bash "$repo_root/.github/scripts/capture-antigravity.sh"; then
      capture_status=1
      capture_message="Antigravity live capture was incomplete; retry later."
    fi
    ;;
  *)
    echo "Unknown capture tool: $tool" >&2
    exit 2
    ;;
esac

if [ "$capture_status" -ne 0 ]; then
  write_result retry_capture "$capture_message"
  echo "::warning::$capture_message" >&2
  exit 0
fi

if ! node "$repo_root/.github/scripts/prepare-capture-output.cjs" \
  "$tool" "$tool_scratch" "$tool_output/evidence"; then
  write_result security_error "Capture evidence failed redaction/secret validation."
  echo "::error::$tool evidence failed the security gate; no evidence was uploaded" >&2
  rm -rf "$tool_output/evidence"
  exit 1
fi

write_result captured "$capture_message"
