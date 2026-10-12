#!/usr/bin/env bash
# Resolve the newest release of each provider and the exact artifact digest to pin.
# This step is deterministic on purpose: digests are trust anchors, not judgement calls.
#
# Env: PROVIDERS (comma list or "all"), FORCE (true = refresh even at the same version).
# Writes JSON to stdout: {"driver": {...}, "include": [plan entries]}.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
providers="${PROVIDERS:-all}"
force="${FORCE:-false}"
[ "$providers" = all ] && providers="claude-code,codex,grok,antigravity,qwen-code"

field() { awk -F' = ' -v f="$2" '$1 == f { sub(/\r$/, "", $2); print $2; exit }' "$repo_root/$1/VERSION"; }
semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$2" ]; }
fetch() { curl -fsSL --retry 3 --connect-timeout 10 --max-time 300 "$@"; }
warn() { echo "::warning::$*" >&2; }
npm_hex() { node -e 'process.stdout.write(Buffer.from(process.argv[1].replace(/^sha512-/, ""), "base64").toString("hex"))' "$1"; }
tag_rev() { git ls-remote --tags "$1" "refs/tags/$2" "refs/tags/$2^{}" | awk '{r=$1} /\^\{\}$/ {p=$1} END {print (p ? p : r)}'; }

claude_release() {
  local version="$1" sha
  sha="$(fetch "https://downloads.claude.ai/claude-code-releases/$version/manifest.json" | jq -er '.platforms["linux-x64"].checksum')"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  jq -cn --arg url "https://downloads.claude.ai/claude-code-releases/$version/linux-x64/claude" --arg sha "$sha" \
    '{url:$url, sha256:$sha}'
}

entries=()
add() {  # provider old new extra-json
  local provider="$1" old="$2" new="$3" extra="$4"
  if [ "$force" != true ] && ! newer "$old" "$new"; then
    echo "$provider: $old is current (latest $new)" >&2
    return 0
  fi
  echo "$provider: $old -> $new" >&2
  entries+=("$(jq -cn --arg p "$provider" --arg old "$old" --arg new "$new" --argjson extra "$extra" \
    '{provider:$p, old_version:$old, new_version:$new} + $extra')")
}

driver_version="$(fetch https://downloads.claude.ai/claude-code-releases/latest | tr -d '[:space:]')"
semver "$driver_version" || { echo "cannot resolve the Claude Code driver release" >&2; exit 1; }
driver="$(claude_release "$driver_version" | jq -c --arg v "$driver_version" '. + {version:$v}')"

for provider in ${providers//,/ }; do
  case "$provider" in
    claude-code)
      latest="$driver_version"
      artifact="$(claude_release "$latest")" || { warn "claude-code $latest has no linux-x64 checksum"; continue; }
      add claude-code "$(field claude-code version)" "$latest" "$(jq -c \
        '{version_field:"version", target:{kind:"binary", bin:"claude", url:.url, sha256:.sha256}}' <<<"$artifact")"
      ;;
    codex)
      latest="$(npm view @openai/codex version)"
      semver "$latest" || { warn "codex: no stable npm release"; continue; }
      rev="$(tag_rev https://github.com/openai/codex.git "rust-v$latest")"
      [[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { warn "codex $latest has no rust-v tag yet"; continue; }
      add codex "$(field codex codex_cli_package_version)" "$latest" "$(jq -cn --arg v "$latest" --arg rev "$rev" \
        '{version_field:"codex_cli_package_version", revision:$rev,
          target:{kind:"npm", npm:("@openai/codex@" + $v)}}')"
      ;;
    qwen-code)
      latest="$(npm view @qwen-code/qwen-code version)"
      semver "$latest" || { warn "qwen-code: no stable npm release"; continue; }
      rev="$(tag_rev https://github.com/QwenLM/qwen-code.git "v$latest")"
      [[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { warn "qwen-code $latest has no v tag yet"; continue; }
      add qwen-code "$(field qwen-code version)" "$latest" "$(jq -cn --arg v "$latest" --arg rev "$rev" \
        '{version_field:"version", revision:$rev, target:{kind:"npm", npm:("@qwen-code/qwen-code@" + $v)}}')"
      ;;
    grok)
      latest="$(fetch https://x.ai/cli/stable | tr -d '[:space:]')"
      semver "$latest" || { warn "grok: cannot resolve the stable pointer"; continue; }
      if [ "$force" != true ] && ! newer "$(field grok version)" "$latest"; then
        echo "grok: $(field grok version) is current (latest $latest)" >&2; continue
      fi
      # x.ai publishes no checksum; pin the digest of the bytes served now.
      url="https://x.ai/cli/grok-${latest}-linux-x86_64"
      tmp="$(mktemp)"; fetch "$url" -o "$tmp"; sha="$(sha256sum "$tmp" | cut -d' ' -f1)"; rm -f "$tmp"
      add grok "$(field grok version)" "$latest" "$(jq -cn --arg url "$url" --arg sha "$sha" \
        '{version_field:"version", target:{kind:"binary", bin:"grok", url:$url, sha256:$sha}}')"
      ;;
    antigravity)
      manifest="$(fetch https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json)"
      latest="$(jq -r '.version' <<<"$manifest")"
      semver "$latest" && [[ "$(jq -r '.sha512' <<<"$manifest")" =~ ^[0-9a-f]{128}$ ]] &&
        [[ "$(jq -r '.url' <<<"$manifest")" =~ ^https://storage\.googleapis\.com/antigravity-public/ ]] ||
        { warn "antigravity: invalid updater manifest"; continue; }
      add antigravity "$(field antigravity version)" "$latest" "$(jq -c \
        '{version_field:"version", target:{kind:"tarball", bin:"agy", tar_member:"antigravity", url:.url, sha512:.sha512}}' \
        <<<"$manifest")"
      ;;
    *) echo "unknown provider: $provider" >&2; exit 2 ;;
  esac
done

printf '%s\n' "${entries[@]+"${entries[@]}"}" | jq -cs --argjson driver "$driver" '{driver:$driver, include:.}'
