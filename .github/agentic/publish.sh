#!/usr/bin/env bash
# Apply each approved provider patch to a fresh checkout as its own commit, re-validated
# by the default branch's own code, then publish.
#
# Usage: publish.sh <bundles-dir> <branch|release>

set -euo pipefail

bundles="${1:?}"; mode="${2:?}"
repo="$(git rev-parse --show-toplevel)"; cd "$repo"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

notes="Agentic refresh of normalized prompts and tool schemas."
subjects=()
for bundle in "$bundles"/*/; do
  [ -f "$bundle/meta.json" ] || continue
  provider="$(jq -r .provider "$bundle/meta.json")"
  old="$(jq -r .old_version "$bundle/meta.json")"
  new="$(jq -r .new_version "$bundle/meta.json")"
  field="$(jq -r .version_field "$bundle/meta.json")"
  patch="$bundle/$provider.patch"
  [ -s "$patch" ] || continue
  # A patch may only touch its own provider directory.
  if git apply --numstat "$patch" | awk '{print $3}' | grep -v "^$provider/" | grep -q .; then
    echo "::error::$provider patch touches paths outside $provider/"; exit 1
  fi
  git apply --index --whitespace=nowarn "$patch"
  node .github/scripts/generate-catalog.cjs >/dev/null
  node .github/agentic/validate.cjs "$provider" "$field" "$new"
  git add -A -- "$provider" CATALOG.md

  summary="$(cat "$bundle/summary.md" 2>/dev/null || true)"
  review="$(cat "$bundle/review.md" 2>/dev/null || true)"
  if [ "$old" = "$new" ]; then subject="Refresh $provider $new surfaces"; else subject="Refresh $provider $old -> $new"; fi
  git commit -q -m "$subject" -m "${summary:-No summary.}" -m "Independent review: ${review:-approved}"
  subjects+=("$provider $new")
  notes+=$'\n\n'"## $provider $new"$'\n\n'"${summary:-No summary.}"$'\n\n'"_Review:_ ${review:-approved}"
done

[ "${#subjects[@]}" -gt 0 ] || { echo "Nothing to publish."; exit 0; }
node .github/scripts/validate-surfaces.cjs

if [ "$mode" = branch ]; then
  branch="agentic/refresh-${GITHUB_RUN_ID:-local}"
  git push -q origin "HEAD:refs/heads/$branch"
  url="https://github.com/${GITHUB_REPOSITORY}/compare/${GITHUB_REF_NAME:-master}...$branch?expand=1"
  gh pr create --head "$branch" --base "${GITHUB_REF_NAME:-master}" --title "Refresh ${subjects[*]}" --body "$notes" 2>/dev/null ||
    echo "Open a PR: $url"
  echo "### Pushed \`$branch\`"$'\n\n'"$url" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi

today="$(date -u +%Y.%m.%d)"; tag="$today"; n=2
while git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; do
  tag="$today-$n"; n=$((n + 1))
done
git tag -a "$tag" -m "Agentic refresh $today" -m "$notes"
git push --atomic origin HEAD "$tag"
gh release create "$tag" --title "$tag" --notes "$notes"
echo "Released $tag: ${subjects[*]}"
