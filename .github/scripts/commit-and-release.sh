#!/usr/bin/env bash
# Commits whichever tool directories actually changed after run-codex-refresh.sh,
# tags YYYY.MM.DD (appending -2/-3 if that date already has a tag), pushes, and
# cuts a GitHub release. Only tags/releases if at least one tool had a real
# commit — a no-op day produces no commit, no tag, no release.
#
# The decision of "did this tool actually change" comes from `git status`, not
# from parsing codex's prose — that's the robust source of truth. Codex's
# per-tool summary sections are only used for commit/release body text.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_dir="$repo_root/.github/scripts"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
summary_file="${CODEX_SUMMARY_FILE:-$scratch_dir/codex-summary.md}"
review_file="${CODEX_REVIEW_FILE:-$scratch_dir/review-result.json}"

cd "$repo_root"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

body_for_tool() {
  # Extracts the "## <tool>" ... (next "## " or EOF) section from the codex summary.
  local tool="$1"
  [ -f "$summary_file" ] || return
  awk -v tool="## $tool" '
    $0 == tool { found=1; next }
    found && /^## / { exit }
    found { print }
  ' "$summary_file"
}

release_notes=""
commit_count=0

if ! node "$script_dir/validate-review.cjs" "$changed_file" "$review_file"; then
  echo "Independent review did not approve this refresh; refusing to publish." >&2
  exit 1
fi

while IFS= read -r entry; do
  tool="$(jq -r '.tool' <<<"$entry")"
  dir="$(jq -r '.dir' <<<"$entry")"
  new_version="$(jq -r '.new_version' <<<"$entry")"

  if git status --porcelain -- "$dir" | grep -q .; then
    git add "$dir"
    body="$(body_for_tool "$tool")"
    [ -z "$body" ] && body="Automated daily capture refresh to $new_version."
    git commit -m "Update $tool captures to $new_version" -m "$body"
    commit_count=$((commit_count + 1))
    release_notes+=$'\n\n'"## $tool"$'\n'"$body"
    echo "Committed $tool ($dir) -> $new_version"
  else
    echo "$tool: version changed ($new_version) but no content diff — skipping commit"
  fi
done < <(jq -c '.[]' "$changed_file")

if [ "$commit_count" -eq 0 ]; then
  echo "No commits made today — skipping tag/release."
  exit 0
fi

today="$(date -u +%Y.%m.%d)"
tag="$today"
suffix=2
while git rev-parse "$tag" >/dev/null 2>&1 || git ls-remote --tags origin "refs/tags/$tag" | grep -q .; do
  tag="${today}-${suffix}"
  suffix=$((suffix + 1))
done

git tag -a "$tag" -m "Automated capture refresh $today"

branch="$(git rev-parse --abbrev-ref HEAD)"
git push --atomic origin "$branch" "$tag"

gh release create "$tag" \
  --repo "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}" \
  --title "$tag" \
  --notes "Automated daily capture refresh.${release_notes}"

echo "Released $tag with $commit_count commit(s)."
