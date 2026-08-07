#!/usr/bin/env bash
# Repair the narrow failure window where commits and an annotated tag were
# pushed atomically but GitHub release creation failed afterward.

set -euo pipefail

repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$repo_root"
git fetch --quiet origin --tags

default_branch="${DEFAULT_BRANCH:-$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')}"
[ -n "$default_branch" ] || { echo "Could not resolve the default branch; refusing release reconciliation." >&2; exit 1; }
git rev-parse --verify "refs/remotes/origin/$default_branch^{commit}" >/dev/null 2>&1 || {
  echo "Remote default branch origin/$default_branch is unavailable; refusing release reconciliation." >&2
  exit 1
}

repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
if ! released_tags="$(gh api --paginate "repos/$repository/releases?per_page=100" --jq '.[].tag_name')"; then
  echo "Could not query the repository release ledger; refusing to infer missing releases." >&2
  exit 1
fi

found=false
missing=false
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  if ! [[ "$tag" =~ ^20[0-9]{2}\.(0[1-9]|1[0-2])\.(0[1-9]|[12][0-9]|3[01])(-([2-9]|[1-9][0-9]+))?$ ]]; then
    continue
  fi
  [ "$(git cat-file -t "refs/tags/$tag" 2>/dev/null || true)" = tag ] || {
    echo "$tag is not an annotated automated-release tag; skipping."
    continue
  }
  tag_date="${tag%%-*}"
  first_line="$(git for-each-ref --format='%(contents)' "refs/tags/$tag" | sed -n '1p')"
  if [ "$first_line" != "Automated capture refresh $tag_date" ]; then
    echo "$tag does not carry the automated capture annotation; skipping."
    continue
  fi
  if ! git merge-base --is-ancestor "${tag}^{}" "origin/$default_branch"; then
    echo "$tag is not reachable from origin/$default_branch; skipping."
    continue
  fi
  found=true
  if grep -Fqx -- "$tag" <<<"$released_tags"; then
    continue
  fi

  missing=true
  notes="$(git for-each-ref --format='%(contents)' "refs/tags/$tag")"
  [ -n "$notes" ] || { echo "$tag has no annotation body; refusing release reconciliation." >&2; exit 1; }
  gh release create "$tag" \
    --repo "$repository" \
    --title "$tag" \
    --notes "$notes"
  echo "Recovered missing GitHub release $tag."
done < <(git tag --list '20??.??.??*' --sort=version:refname)

[ "$found" = true ] || echo "No dated capture tag requires reconciliation."
[ "$found" != true ] || [ "$missing" = true ] || echo "Every eligible capture tag already has a GitHub release."
