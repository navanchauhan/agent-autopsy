#!/usr/bin/env bash
# Resolves exact upstream CLI releases without installing them. The resulting
# manifest is both the change detector and the immutable capture plan.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
automation_state_dir="${AUTOMATION_STATE_DIR:-$scratch_dir/automation-state}"
ledger_file="${RELEASE_LEDGER_FILE:-$automation_state_dir/release-ledger.json}"
grok_refresh_enabled="${GROK_REFRESH_ENABLED:-true}"
claude_fast_forward="${CLAUDE_FAST_FORWARD:-false}"
mkdir -p "$scratch_dir"

case "$grok_refresh_enabled" in
  true|false) ;;
  *) echo "GROK_REFRESH_ENABLED must be true or false" >&2; exit 2 ;;
esac
case "$claude_fast_forward" in
  true|false) ;;
  *) echo "CLAUDE_FAST_FORWARD must be true or false" >&2; exit 2 ;;
esac

current_version_field() {
  awk -F' = ' -v field="$2" '$1 == field { sub(/\r$/, "", $2); print $2; exit }' "$1"
}

capture_contract_hash() {
  local tool="$1"
  local files=(
    "$repo_root/Dockerfile"
    "$repo_root/.github/scripts/capture-tool.sh"
    "$repo_root/.github/scripts/capture-$tool.sh"
    "$repo_root/.github/scripts/prepare-capture-output.cjs"
    "$repo_root/.github/scripts/select-capture-results.cjs"
    "$repo_root/.github/scripts/seed-credentials.sh"
    "$repo_root/.github/scripts/docker-entrypoint.sh"
  )
  case "$tool" in
    codex)
      files+=("$repo_root/.github/scripts/sync-codex-reference.sh")
      # The artifact source map is part of the Codex capture output, so a change
      # to it must invalidate cached Codex bundles.
      files+=("$repo_root/.github/scripts/codex-artifact-map.cjs")
      ;;
    qwen-code) files+=("$repo_root/.github/scripts/sync-qwen-code-reference.sh") ;;
    grok) files+=("$repo_root/.github/scripts/sync-grok-reference.sh") ;;
  esac
  if [ -d "$repo_root/$tool/misc/scripts" ]; then
    while IFS= read -r -d '' file; do files+=("$file"); done < <(
      find "$repo_root/$tool/misc/scripts" -type f -print0 | sort -z
    )
  fi

  local existing=()
  local file
  for file in "${files[@]}"; do
    [ -f "$file" ] && existing+=("$file")
  done
  if [ "${#existing[@]}" -eq 0 ]; then
    printf 'missing'
    return
  fi
  {
    for file in "${existing[@]}"; do
      printf '%s\0' "${file#"$repo_root/"}"
      sha256sum "$file" | cut -d' ' -f1
    done
  } | sha256sum | cut -d' ' -f1
}

entries='[]'
append_entry() {
  local entry="$1"
  local plan_hash
  plan_hash="$(jq -cS . <<<"$entry" | sha256sum | cut -d' ' -f1)"
  entry="$(jq -c --arg plan_hash "$plan_hash" '. + {plan_hash:$plan_hash}' <<<"$entry")"
  entries="$(jq -ce --argjson entry "$entry" '. + [$entry]' <<<"$entries")"
}

warn_skip() {
  echo "::warning::$1" >&2
}

queued_target() {
  local tool="$1" version="$2"
  [ -s "$ledger_file" ] || return 1
  jq -ce --arg tool "$tool" --arg version "$version" '
    first(.queues[$tool][]? | select(.new_version == $version))
  ' "$ledger_file" 2>/dev/null
}

is_newer_version() {
  local recorded="$1" candidate="$2"
  [ "$candidate" != "$recorded" ] &&
    [ "$(printf '%s\n%s\n' "$recorded" "$candidate" | sort -V | tail -n1)" = "$candidate" ]
}

is_release_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

warn_if_downgrade() {
  local tool="$1" recorded="$2" candidate="$3"
  if [ "$candidate" != "$recorded" ] && ! is_newer_version "$recorded" "$candidate"; then
    warn_skip "$tool candidate $candidate is not newer than recorded $recorded; refusing a downgrade"
  fi
}

# Claude Code publishes matching npm versions and signed manifests for every
# exact native release. Enumerate the full stable interval so several releases
# between hourly polls cannot collapse into only the newest one.
claude_recorded="$(current_version_field "$repo_root/claude-code/VERSION" version)"
claude_latest="$(curl -fsSL --connect-timeout 10 --max-time 30 \
  https://downloads.claude.ai/claude-code-releases/latest 2>/dev/null | tr -d '[:space:]' || true)"
claude_versions_json="$(timeout 30s npm view @anthropic-ai/claude-code versions --json 2>/dev/null || true)"
if [ "$claude_fast_forward" = true ]; then
  claude_candidates="$(
    if is_release_version "$claude_latest"; then
      printf '%s\n' "$claude_latest"
    fi
  )"
else
  claude_candidates="$({
    jq -r '.[]? | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' \
      <<<"$claude_versions_json" 2>/dev/null || true
    is_release_version "$claude_latest" && printf '%s\n' "$claude_latest"
  } | sort -Vu)"
fi
claude_version="$claude_recorded"
while IFS= read -r observed_version; do
  [ -n "$observed_version" ] || continue
  is_newer_version "$claude_recorded" "$observed_version" || continue
  if is_release_version "$claude_latest" && is_newer_version "$claude_latest" "$observed_version"; then
    continue
  fi

  claude_url="https://downloads.claude.ai/claude-code-releases/$observed_version/linux-x64/claude"
  claude_checksum=''
  queued="$(queued_target claude-code "$observed_version" || true)"
  if [ -n "$queued" ] &&
     [ "$(jq -r '.artifact_url // empty' <<<"$queued")" = "$claude_url" ] &&
     [[ "$(jq -r '.artifact_sha256 // empty' <<<"$queued")" =~ ^[0-9a-f]{64}$ ]]; then
    claude_checksum="$(jq -r '.artifact_sha256' <<<"$queued")"
  else
    claude_manifest="$(curl -fsSL --connect-timeout 10 --max-time 30 \
      "https://downloads.claude.ai/claude-code-releases/$observed_version/manifest.json" 2>/dev/null || true)"
    claude_checksum="$(jq -er '.platforms["linux-x64"].checksum' \
      <<<"$claude_manifest" 2>/dev/null || true)"
  fi
  if [[ "$claude_checksum" =~ ^[0-9a-f]{64}$ ]]; then
    append_entry "$(jq -cn \
      --arg tool claude-code --arg dir claude-code \
      --arg old "$claude_recorded" --arg new "$observed_version" \
      --arg checksum "$claude_checksum" --arg url "$claude_url" \
      --arg contract "$(capture_contract_hash claude-code)" \
      '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"version",artifact_url:$url,artifact_sha256:$checksum,capture_contract_hash:$contract}')"
    claude_version="$observed_version"
  else
    warn_skip "Claude Code $observed_version has no valid linux-x64 signed-manifest checksum"
  fi
done <<<"$claude_candidates"
if is_release_version "$claude_latest"; then
  echo "claude-code: recorded=$claude_recorded latest=$claude_latest newest_validated=$claude_version" >&2
  warn_if_downgrade "Claude Code" "$claude_recorded" "$claude_latest"
else
  warn_skip "Could not resolve the Claude Code native latest pointer; exact npm manifests were still checked"
fi

# Codex snapshots released CLI tags rather than arbitrary commits on upstream
# HEAD. This guarantees one archive transition per published CLI release.
codex_recorded="$(current_version_field "$repo_root/codex/VERSION" codex_cli_package_version)"
codex_versions_json="$(timeout 30s npm view @openai/codex versions --json 2>/dev/null || true)"
codex_stable_versions="$(jq -r '.[] | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' \
  <<<"$codex_versions_json" 2>/dev/null | sort -Vu || true)"
codex_version="$(tail -n1 <<<"$codex_stable_versions" | tr -d '[:space:]')"
codex_revision=''
if is_release_version "$codex_version"; then
  codex_tags="$(timeout 30s git ls-remote --tags https://github.com/openai/codex.git 'refs/tags/rust-v*' 2>/dev/null || true)"
  codex_revision="$(awk -v ref="refs/tags/rust-v${codex_version}" \
    '$2 == ref "^{}" { print $1; found=1; exit } $2 == ref { fallback=$1 } END { if (!found && fallback) print fallback }' \
    <<<"$codex_tags")"
  echo "codex: recorded=$codex_recorded latest=$codex_version revision=${codex_revision:-missing}" >&2
  warn_if_downgrade "Codex" "$codex_recorded" "$codex_version"
  if is_newer_version "$codex_recorded" "$codex_version"; then
    while IFS= read -r observed_version; do
      [ -n "$observed_version" ] || continue
      is_newer_version "$codex_recorded" "$observed_version" || continue
      observed_revision="$(awk -v ref="refs/tags/rust-v${observed_version}" \
        '$2 == ref "^{}" { print $1; found=1; exit } $2 == ref { fallback=$1 } END { if (!found && fallback) print fallback }' \
        <<<"$codex_tags")"
      if [[ "$observed_revision" =~ ^[0-9a-f]{40}$ ]]; then
        append_entry "$(jq -cn \
          --arg tool codex --arg dir codex \
          --arg old "$codex_recorded" --arg new "$observed_version" \
          --arg old_revision "$(current_version_field "$repo_root/codex/VERSION" revision)" \
          --arg new_revision "$observed_revision" \
          --arg contract "$(capture_contract_hash codex)" \
          '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"codex_cli_package_version",old_revision:$old_revision,new_revision:$new_revision,capture_contract_hash:$contract}')"
      else
        warn_skip "Codex $observed_version is published to npm but its rust-v$observed_version source tag is unavailable"
      fi
    done <<<"$codex_stable_versions"
  fi
else
  warn_skip "Could not resolve a valid Codex CLI release (received: $codex_version)"
  codex_version="$codex_recorded"
fi

# Antigravity's live manifest is authoritative for the newest Linux artifact.
# Its bucket has no public version index, so Homebrew's cask history is used
# only to discover intermediate official GCS URLs; each discovered tarball is
# downloaded, verified against the cask SHA-256, and independently SHA-512'd.
antigravity_recorded="$(current_version_field "$repo_root/antigravity/VERSION" version)"
antigravity_manifest="$(curl -fsSL --connect-timeout 10 --max-time 30 https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json 2>/dev/null || true)"
antigravity_version="$(jq -er '.version' <<<"$antigravity_manifest" 2>/dev/null || true)"
antigravity_url="$(jq -er '.url' <<<"$antigravity_manifest" 2>/dev/null || true)"
antigravity_sha512="$(jq -er '.sha512' <<<"$antigravity_manifest" 2>/dev/null || true)"
if ! is_release_version "$antigravity_version" ||
   ! [[ "$antigravity_sha512" =~ ^[0-9a-f]{128}$ ]] ||
   ! [[ "$antigravity_url" =~ ^https://storage\.googleapis\.com/antigravity-public/antigravity-cli/${antigravity_version//./\.}-[0-9]+/linux-x64/cli_linux_x64\.tar\.gz$ ]]; then
  warn_skip "Could not resolve a valid Antigravity linux_amd64 manifest"
  antigravity_version="$antigravity_recorded"
  antigravity_url="$(current_version_field "$repo_root/antigravity/VERSION" manifest_tarball_url)"
  antigravity_sha512="$(current_version_field "$repo_root/antigravity/VERSION" manifest_tarball_sha512)"
fi
echo "antigravity: recorded=$antigravity_recorded latest=$antigravity_version" >&2
warn_if_downgrade "Antigravity" "$antigravity_recorded" "$antigravity_version"
if is_newer_version "$antigravity_recorded" "$antigravity_version"; then
  antigravity_lookup_dir="$(mktemp -d)"
  if timeout 3m git clone --quiet --filter=blob:none --no-checkout --depth 256 --single-branch \
      https://github.com/Homebrew/homebrew-cask.git "$antigravity_lookup_dir" 2>/dev/null; then
    declare -A antigravity_seen=()
    while IFS= read -r cask_revision; do
      cask="$(git -C "$antigravity_lookup_dir" show \
        "$cask_revision:Casks/a/antigravity-cli.rb" 2>/dev/null || true)"
      cask_pair="$(sed -nE 's/^  version "([0-9]+\.[0-9]+\.[0-9]+),([0-9]+)"$/\1 \2/p' \
        <<<"$cask" | head -n1)"
      read -r cask_version cask_build <<<"$cask_pair"
      [ -n "${cask_version:-}" ] && [ -n "${cask_build:-}" ] || continue
      [ -z "${antigravity_seen[$cask_version]:-}" ] || continue
      antigravity_seen[$cask_version]=1
      is_newer_version "$antigravity_recorded" "$cask_version" || continue
      is_newer_version "$antigravity_version" "$cask_version" && continue

      cask_sha256="$(sed -nE 's/^ *x86_64_linux: "([0-9a-f]{64})".*$/\1/p' \
        <<<"$cask" | head -n1)"
      cask_url="https://storage.googleapis.com/antigravity-public/antigravity-cli/${cask_version}-${cask_build}/linux-x64/cli_linux_x64.tar.gz"
      queued="$(queued_target antigravity "$cask_version" || true)"
      if [ -n "$queued" ] &&
         [ "$(jq -r '.artifact_url // empty' <<<"$queued")" = "$cask_url" ] &&
         [[ "$(jq -r '.artifact_sha512 // empty' <<<"$queued")" =~ ^[0-9a-f]{128}$ ]]; then
        echo "antigravity: reusing durable metadata for $cask_version" >&2
        continue
      fi

      cask_download="$(mktemp)"
      cask_sha512=''
      if [[ "$cask_sha256" =~ ^[0-9a-f]{64}$ ]] &&
         curl -fsSL --connect-timeout 10 --max-time 300 "$cask_url" -o "$cask_download" 2>/dev/null &&
         printf '%s  %s\n' "$cask_sha256" "$cask_download" | sha256sum -c - >/dev/null 2>&1; then
        cask_sha512="$(sha512sum "$cask_download" | cut -d' ' -f1)"
      fi
      rm -f -- "$cask_download"
      if [[ "$cask_sha512" =~ ^[0-9a-f]{128}$ ]]; then
        append_entry "$(jq -cn \
          --arg tool antigravity --arg dir antigravity \
          --arg old "$antigravity_recorded" --arg new "$cask_version" \
          --arg url "$cask_url" --arg sha512 "$cask_sha512" \
          --arg contract "$(capture_contract_hash antigravity)" \
          '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"version",artifact_url:$url,artifact_sha512:$sha512,capture_contract_hash:$contract}')"
        echo "antigravity: discovered cask-backed official artifact $cask_version" >&2
      else
        warn_skip "Could not validate the official Antigravity $cask_version Linux tarball from cask history"
      fi
    done < <(git -C "$antigravity_lookup_dir" log --format=%H -- Casks/a/antigravity-cli.rb)
  else
    warn_skip "Could not inspect Homebrew cask history for intermediate Antigravity releases"
  fi
  rm -rf -- "$antigravity_lookup_dir"

  # Always add the authoritative live target; the ledger deduplicates it when
  # cask history already discovered the same immutable artifact.
  append_entry "$(jq -cn \
    --arg tool antigravity --arg dir antigravity \
    --arg old "$antigravity_recorded" --arg new "$antigravity_version" \
    --arg url "$antigravity_url" --arg sha512 "$antigravity_sha512" \
    --arg contract "$(capture_contract_hash antigravity)" \
    '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"version",artifact_url:$url,artifact_sha512:$sha512,capture_contract_hash:$contract}')"
fi

# Grok's stable pointer bounds the released interval. The public mirror's
# per-version changelogs preserve releases that share a synchronized source
# snapshot and therefore cannot be recovered from Cargo.toml alone.
grok_recorded="$(current_version_field "$repo_root/grok/VERSION" version)"
grok_version="$grok_recorded"
if [ "$grok_refresh_enabled" = true ]; then
grok_version="$(curl -fsSL --connect-timeout 10 --max-time 30 https://x.ai/cli/stable 2>/dev/null | tr -d '[:space:]' || true)"
if is_release_version "$grok_version"; then
  warn_if_downgrade "Grok" "$grok_recorded" "$grok_version"
else
  warn_skip "Could not resolve a valid Grok stable release"
  grok_version="$grok_recorded"
fi
if is_newer_version "$grok_recorded" "$grok_version"; then
  grok_lookup_dir="$(mktemp -d)"
  if timeout 3m git clone --quiet --filter=blob:none --no-checkout --depth 2048 \
      https://github.com/xai-org/grok-build.git "$grok_lookup_dir" 2>/dev/null; then
    grok_candidates="$(git -C "$grok_lookup_dir" ls-tree -r --name-only HEAD \
      crates/codegen/xai-grok-shell/changelogs 2>/dev/null |
      sed -nE 's#^.*/([0-9]+\.[0-9]+\.[0-9]+)\.md$#\1#p' | sort -Vu)"
    while IFS= read -r observed_version; do
      [ -n "$observed_version" ] || continue
      is_newer_version "$grok_recorded" "$observed_version" || continue
      is_newer_version "$grok_version" "$observed_version" && continue

      grok_artifact_url="https://x.ai/cli/grok-${observed_version}-linux-x86_64"
      queued="$(queued_target grok "$observed_version" || true)"
      if [ -n "$queued" ] &&
         [ "$(jq -r '.artifact_url // empty' <<<"$queued")" = "$grok_artifact_url" ] &&
         [[ "$(jq -r '.artifact_sha256 // empty' <<<"$queued")" =~ ^[0-9a-f]{64}$ ]] &&
         [[ "$(jq -r '.new_revision // empty' <<<"$queued")" =~ ^[0-9a-f]{40}$ ]] &&
         [[ "$(jq -r '.mirror_revision // empty' <<<"$queued")" =~ ^[0-9a-f]{40}$ ]]; then
        echo "grok: reusing durable metadata for $observed_version" >&2
        continue
      fi

      changelog_path="crates/codegen/xai-grok-shell/changelogs/${observed_version}.md"
      grok_mirror_revision="$(git -C "$grok_lookup_dir" log --format=%H --diff-filter=A -- \
        "$changelog_path" | tail -n1)"
      grok_source_revision="$(git -C "$grok_lookup_dir" show \
        "$grok_mirror_revision:SOURCE_REV" 2>/dev/null | tr -d '[:space:]' || true)"
      grok_artifact_sha256=''
      grok_download="$(mktemp)"
      if [[ "$grok_mirror_revision" =~ ^[0-9a-f]{40}$ ]] &&
         [[ "$grok_source_revision" =~ ^[0-9a-f]{40}$ ]] &&
         curl -fsSL --connect-timeout 10 --max-time 300 \
           "$grok_artifact_url" -o "$grok_download" 2>/dev/null && [ -s "$grok_download" ]; then
        grok_artifact_sha256="$(sha256sum "$grok_download" | cut -d' ' -f1)"
      fi
      rm -f -- "$grok_download"

      if [[ "$grok_artifact_sha256" =~ ^[0-9a-f]{64}$ ]]; then
        append_entry "$(jq -cn \
          --arg tool grok --arg dir grok \
          --arg old "$grok_recorded" --arg new "$observed_version" \
          --arg old_revision "$(current_version_field "$repo_root/grok/VERSION" revision)" \
          --arg new_revision "$grok_source_revision" \
          --arg mirror_revision "$grok_mirror_revision" \
          --arg url "$grok_artifact_url" --arg sha256 "$grok_artifact_sha256" \
          --arg contract "$(capture_contract_hash grok)" \
          '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"version",old_revision:$old_revision,new_revision:$new_revision,mirror_revision:$mirror_revision,artifact_url:$url,artifact_sha256:$sha256,capture_contract_hash:$contract}')"
        echo "grok: discovered $observed_version at mirror $grok_mirror_revision" >&2
      else
        warn_skip "Could not bind Grok $observed_version to its changelog source snapshot and official binary digest"
      fi
    done <<<"$grok_candidates"
  else
    warn_skip "Could not clone the Grok public source mirror to enumerate stable releases"
  fi
  rm -rf -- "$grok_lookup_dir"
fi
echo "grok: recorded=$grok_recorded latest=$grok_version" >&2
else
  echo "grok: refresh disabled; skipping discovery and capture planning" >&2
fi

# Qwen Code publishes stable npm releases and matching public Git tags. Source
# is complete capture evidence, so no package installation or credential is needed.
qwen_recorded="$(current_version_field "$repo_root/qwen-code/VERSION" version)"
qwen_version="$(timeout 30s npm view @qwen-code/qwen-code version --json 2>/dev/null | jq -er '.' 2>/dev/null || true)"
qwen_revision=''
if is_release_version "$qwen_version"; then
  qwen_revision="$(git ls-remote --tags https://github.com/QwenLM/qwen-code.git \
    "refs/tags/v${qwen_version}" 2>/dev/null | cut -f1 | head -n1)"
fi
echo "qwen-code: recorded=$qwen_recorded latest=${qwen_version:-unresolved} revision=${qwen_revision:-missing}" >&2
warn_if_downgrade "Qwen Code" "$qwen_recorded" "${qwen_version:-$qwen_recorded}"
if is_newer_version "$qwen_recorded" "$qwen_version" && [[ "$qwen_revision" =~ ^[0-9a-f]{40}$ ]]; then
  append_entry "$(jq -cn \
    --arg tool qwen-code --arg dir qwen-code \
    --arg old "$qwen_recorded" --arg new "$qwen_version" \
    --arg old_revision "$(current_version_field "$repo_root/qwen-code/VERSION" revision)" \
    --arg new_revision "$qwen_revision" \
    --arg contract "$(capture_contract_hash qwen-code)" \
    '{tool:$tool,dir:$dir,old_version:$old,new_version:$new,version_field:"version",old_revision:$old_revision,new_revision:$new_revision,capture_contract_hash:$contract}')"
else
  qwen_version="$qwen_recorded"
fi

# Merge every observed target into the durable per-tool FIFO. The emitted plan
# contains only each queue head, rebased to the repository's current VERSION.
fresh_file="$scratch_dir/fresh-targets.json"
current_state_file="$scratch_dir/current-release-state.json"
ledger_next="$scratch_dir/release-ledger.next.json"
printf '%s\n' "$entries" | jq -S . >"$fresh_file"
jq -n \
  --arg codex_version "$codex_recorded" \
  --arg codex_revision "$(current_version_field "$repo_root/codex/VERSION" revision)" \
  --arg codex_contract "$(capture_contract_hash codex)" \
  --arg claude_version "$claude_recorded" \
  --arg claude_contract "$(capture_contract_hash claude-code)" \
  --arg grok_version "$grok_recorded" \
  --arg grok_revision "$(current_version_field "$repo_root/grok/VERSION" revision)" \
  --arg grok_contract "$(capture_contract_hash grok)" \
  --arg antigravity_version "$antigravity_recorded" \
  --arg antigravity_contract "$(capture_contract_hash antigravity)" \
  --arg qwen_version "$qwen_recorded" \
  --arg qwen_revision "$(current_version_field "$repo_root/qwen-code/VERSION" revision)" \
  --arg qwen_contract "$(capture_contract_hash qwen-code)" \
  '{codex:{version:$codex_version,revision:$codex_revision,capture_contract_hash:$codex_contract},
    "claude-code":{version:$claude_version,capture_contract_hash:$claude_contract},
    grok:{version:$grok_version,revision:$grok_revision,capture_contract_hash:$grok_contract},
    antigravity:{version:$antigravity_version,capture_contract_hash:$antigravity_contract},
    "qwen-code":{version:$qwen_version,revision:$qwen_revision,capture_contract_hash:$qwen_contract}}' \
  >"$current_state_file"
mkdir -p "$(dirname "$ledger_file")"
ledger_input="$ledger_file"
if [ "$claude_fast_forward" = true ] && [ -s "$ledger_file" ]; then
  ledger_input="$scratch_dir/release-ledger.claude-fast-forward.json"
  jq -S '.queues["claude-code"] = []' "$ledger_file" >"$ledger_input"
  echo "claude-code: discarded older queued releases for this manual fast-forward" >&2
fi
node "$repo_root/.github/scripts/release-ledger.cjs" \
  "$ledger_input" "$fresh_file" "$current_state_file" "$ledger_next" "$changed_file"
if [ "$ledger_input" != "$ledger_file" ]; then
  rm -f -- "$ledger_input"
fi
mv -f "$ledger_next" "$ledger_file"
if [ "$grok_refresh_enabled" = false ]; then
  disabled_plan="$(mktemp "$scratch_dir/.changed-tools.without-grok.XXXXXX")"
  jq -S 'map(select(.tool != "grok"))' "$changed_file" >"$disabled_plan"
  mv -f "$disabled_plan" "$changed_file"
  echo "grok: preserved in the durable queue but omitted from the active plan" >&2
fi
echo "Wrote $changed_file:" >&2
cat "$changed_file" >&2

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  if jq -e 'length > 0' "$changed_file" >/dev/null; then
    echo 'has_changes=true' >>"$GITHUB_OUTPUT"
  else
    echo 'has_changes=false' >>"$GITHUB_OUTPUT"
  fi
  {
    echo "changed_tools=$(jq -c . "$changed_file")"
    echo "claude_version=$claude_version"
    echo "codex_version=$codex_version"
    echo "codex_driver_version=$codex_recorded"
    echo "grok_version=$grok_version"
    echo "antigravity_version=$antigravity_version"
    echo "antigravity_url=$antigravity_url"
    echo "antigravity_sha512=$antigravity_sha512"
    echo "qwen_version=$qwen_version"
    echo "capture_bucket=$(date -u +%Y%m%d)"
    echo "release_ledger_hash=$(sha256sum "$ledger_file" | cut -d' ' -f1)"
  } >>"$GITHUB_OUTPUT"
fi
