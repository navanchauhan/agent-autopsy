#!/usr/bin/env bash
# Host-side refresh of one provider: author -> trusted finalize/validate -> review,
# repeated with feedback until approved or out of attempts.
#
# Run from a trusted copy (made before any model or provider code executes) with
# the repository checkout as the working directory.
#
# Env: PLAN_ENTRY (JSON), DRIVER (JSON), IMAGE, MAX_ATTEMPTS, AGENT_MODEL, AGENT_EFFORT,
#      RUN_ROOT (private scratch root), OUT_DIR (publishable outputs),
#      provider secrets + CLAUDE_CODE_OAUTH_TOKEN for the driver.

set -euo pipefail

trusted="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="$(git rev-parse --show-toplevel)"
entry="${PLAN_ENTRY:?}"
provider="$(jq -r .provider <<<"$entry")"
version="$(jq -r .new_version <<<"$entry")"
version_field="$(jq -r .version_field <<<"$entry")"
run_root="${RUN_ROOT:?}"; out_dir="${OUT_DIR:?}"
work="$run_root/work"; scratch="$run_root/scratch"; home="$run_root/home"; review_home="$run_root/review-home"
mkdir -p "$work" "$scratch/out" "$home" "$review_home" "$out_dir"
chmod 700 "$run_root"
jq . <<<"$entry" >"$scratch/plan.json"

# Literal secret values the published tree must never contain.
secrets_file="$run_root/secret-values"
for name in CLAUDE_CODE_OAUTH_TOKEN GROK_AUTH_JSON ANTIGRAVITY_GEMINI_CREDS CODEX_CHATGPT_AUTH_JSON; do
  value="${!name:-}"; [ -n "$value" ] || continue
  printf '%s\n' "$value"
  printf '%s' "$value" | base64 -d 2>/dev/null | grep -oE '[A-Za-z0-9._~+/=-]{24,}' || true
done >"$secrets_file"
export SECRET_VALUES_FILE="$secrets_file"

# The agent edits a copy with its own throwaway history, so nothing it writes can
# reach the host checkout's git config or hooks.
git -C "$repo" archive HEAD | tar -x -C "$work"
git -C "$work" init -q -b base && git -C "$work" add -A &&
  git -C "$work" -c user.name=base -c user.email=base@localhost commit -qm "base"

provider_env=()
case "$provider" in
  claude-code) provider_env=(-e CLAUDE_CODE_OAUTH_TOKEN) ;;  # also the driver's token
  grok) provider_env=(-e GROK_AUTH_JSON) ;;
  antigravity) provider_env=(-e ANTIGRAVITY_GEMINI_CREDS) ;;
  codex) provider_env=(-e CODEX_CHATGPT_AUTH_JSON) ;;
esac

run_agent() {  # role attempt
  local role="$1" attempt="$2" workspace_mode=rw home_dir="$home" env=("${provider_env[@]}")
  if [ "$role" = review ]; then workspace_mode=ro; home_dir="$review_home"; env=(); fi
  docker run --rm --init --memory 8g --cpus 4 \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -e ROLE="$role" -e PROVIDER="$provider" -e ATTEMPT="$attempt" \
    -e AGENT_MODEL -e AGENT_EFFORT -e AGENT_TIMEOUT -e CLAUDE_CODE_OAUTH_TOKEN "${env[@]}" \
    -v "$work:/workspace:$workspace_mode" \
    -v "$home_dir:/home/runner" \
    -v "$scratch:/scratch" \
    -v "$trusted:/trusted:ro" \
    "${IMAGE:?}" bash /trusted/.github/agentic/agent.sh
}

finalize() {
  # Copy back only the provider directory, as plain files.
  if find "$work/$provider" ! -type f ! -type d | grep -q .; then
    echo "- the agent left links or special files under $provider/" >"$scratch/feedback.md"; return 1
  fi
  rm -rf "${repo:?}/$provider"
  cp -R "$work/$provider" "$repo/$provider"
  chmod -R u+rwX,go+rX,a-x+X "$repo/$provider"

  # Trusted fields: pinned digests, evidence digest, hashes, counts, catalog.
  jq -c '[{tool:.provider, dir:.provider, new_version, version_field,
           artifact_url:.target.url, artifact_sha256:.target.sha256, artifact_sha512:.target.sha512}
          | with_entries(select(.value != null))]' "$scratch/plan.json" >"$run_root/changed-tools.json"
  evidence="$( (cd "$scratch" && find evidence -type f -print0 | sort -z | xargs -0r sha256sum) | sha256sum | cut -d' ' -f1)"
  jq -n --arg p "$provider" --arg e "$evidence" '{per_tool:{($p):$e}}' >"$run_root/driver-input.json"
  (
    cd "$repo"
    export CHANGED_TOOLS_FILE="$run_root/changed-tools.json" DRIVER_INPUT_MANIFEST="$run_root/driver-input.json"
    node "$trusted/.github/scripts/update-version-artifacts.cjs" "$provider"
    node "$trusted/.github/scripts/update-surface-hashes.cjs" "$provider"
    node "$trusted/.github/scripts/update-version-counts.cjs" "$provider"
    node "$trusted/.github/scripts/generate-catalog.cjs"
  ) >/dev/null
  # Keep the agent's copy identical to what was validated.
  rm -rf "${work:?}/$provider"; cp -R "$repo/$provider" "$work/$provider"; cp "$repo/CATALOG.md" "$work/CATALOG.md"

  (cd "$repo" && node "$trusted/.github/agentic/validate.cjs" "$provider" "$version_field" "$version") \
    >"$scratch/validation.txt" || { { echo "Validation failed:"; cat "$scratch/validation.txt"; } >"$scratch/feedback.md"; return 1; }
  cat "$scratch/validation.txt"
}

review() {
  mkdir -p "$scratch/review"
  (cd "$repo" && git add -N -- "$provider" && git diff HEAD -- "$provider" CATALOG.md) >"$scratch/review/candidate.diff"
  run_agent review "$1" || true
  local result="$scratch/out/review-$1.result.json"
  if jq -e '.structured_output.decision == "approve" and .structured_output.pii_free
            and .structured_output.secrets_free and .structured_output.evidence_supported' "$result" >/dev/null; then
    jq -r '.structured_output.summary' "$result" >"$out_dir/review.md"
    return 0
  fi
  { echo "Independent review rejected the candidate:"
    jq -r '.structured_output.issues[]? | "- \(.path): \(.problem)"' "$result" 2>/dev/null || echo "- reviewer produced no decision"
  } >"$scratch/feedback.md"
  return 1
}

status=rejected
for attempt in $(seq 1 "${MAX_ATTEMPTS:-3}"); do
  echo "::group::$provider $version attempt $attempt"
  rm -f "$scratch/out/author-$attempt.result.json"
  run_agent author "$attempt" || echo "author exited nonzero"
  if finalize && review "$attempt"; then
    status=approved; echo "::endgroup::"; break
  fi
  echo "Attempt $attempt not accepted:"; sed 's/^/  /' "$scratch/feedback.md" | head -n 40
  echo "::endgroup::"
done

# Rotated provider logins go back to the environment whatever happened.
export_dir="$run_root/credential-export"; mkdir -p "$export_dir"
case "$provider" in
  grok) cp "$home/.grok/auth.json" "$export_dir/grok-auth.json" 2>/dev/null || true; scope=grok ;;
  antigravity) cp "$home/.gemini/antigravity-cli/"{antigravity-oauth-token,installation_id} "$export_dir/" 2>/dev/null || true; scope=antigravity ;;
  codex) cp "$home/.codex/auth.json" "$export_dir/codex-auth.json" 2>/dev/null || true; scope=codex-driver ;;
  *) scope="" ;;
esac
if [ -n "$scope" ]; then
  GH_TOKEN="${REPO_SECRETS_PAT:-}" bash "$trusted/.github/scripts/persist-credential.sh" "$scope" "$export_dir" || true
fi
rm -rf "$export_dir"

[ "$status" = approved ] || { echo "::warning::$provider $version was not approved after ${MAX_ATTEMPTS:-3} attempts"; exit 1; }

# Publishable output: the provider patch (catalog is regenerated at publish) and summary.
(cd "$repo" && git add -N -- "$provider" && git diff --binary --full-index HEAD -- "$provider") >"$out_dir/$provider.patch"
[ -s "$out_dir/$provider.patch" ] || { echo "$provider: approved but no changes"; rm -f "$out_dir/$provider.patch"; exit 0; }
jq -r '.result // ""' "$scratch/out/author-$attempt.result.json" >"$out_dir/summary.md"
jq -c '{provider, old_version, new_version, version_field}' "$scratch/plan.json" >"$out_dir/meta.json"
if [ -s "$secrets_file" ] && grep -qFf "$secrets_file" "$out_dir/summary.md"; then : >"$out_dir/summary.md"; fi
echo "$provider $version approved."
