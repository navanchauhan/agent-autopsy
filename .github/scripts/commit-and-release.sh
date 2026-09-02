#!/usr/bin/env bash
# Commit the already-applied, already-staged reviewed patch as one atomic change,
# then create a dated tag and release with mechanically derived notes.

set -euo pipefail

repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
script_dir="${TRUSTED_SCRIPT_DIR:-$repo_root/.github/scripts}"
scratch_dir="${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}"
validation_evidence_dir="${VALIDATION_EVIDENCE_DIR:-$scratch_dir}"
bundle_dir="${DRIVER_OUTPUT_DIR:-$repo_root/driver-output}"
changed_file="${CHANGED_TOOLS_FILE:-$scratch_dir/changed-tools.json}"
summary_file="${CODEX_SUMMARY_FILE:-$scratch_dir/codex-summary.md}"
review_file="${CODEX_REVIEW_FILE:-$scratch_dir/review-result.json}"

cd "$repo_root"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

CAPTURE_SCRATCH_DIR="$validation_evidence_dir" \
  node "$script_dir/validate-refresh.cjs" "$changed_file" "$summary_file"
node "$script_dir/validate-review.cjs" "$changed_file" "$review_file"

dirs=()
while IFS= read -r dir; do
  dirs+=("$dir")
done < <(jq -er '.[].dir' "$changed_file")
[ "${#dirs[@]}" -gt 0 ] || { echo 'No approved tool directories were supplied.' >&2; exit 1; }

# The index must still be byte-for-byte the reviewed patch. Never restage whole
# directories here: that would admit content created after the publication gate.
indexed_patch="$(mktemp "$scratch_dir/.indexed-patch.XXXXXX")"
trap 'rm -f -- "$indexed_patch"' EXIT
git diff --cached --binary --full-index --no-ext-diff --no-renames HEAD -- "${dirs[@]}" CATALOG.md >"$indexed_patch"
cmp -s "$bundle_dir/candidate.patch" "$indexed_patch" || {
  echo 'The staged candidate no longer matches the independently reviewed patch.' >&2
  exit 1
}
[ -s "$indexed_patch" ] || { echo 'The reviewed patch has no staged changes.' >&2; exit 1; }

if ! git diff --quiet -- "${dirs[@]}" CATALOG.md ||
   [ -n "$(git ls-files --others --exclude-standard -- "${dirs[@]}" CATALOG.md)" ]; then
  echo 'Unreviewed worktree content appeared after the publication gate.' >&2
  exit 1
fi

release_notes='Automated normalized prompt and tool-schema capture refresh.'
subject_tools=()
while IFS= read -r entry; do
  tool="$(jq -r '.tool' <<<"$entry")"
  dir="$(jq -r '.dir' <<<"$entry")"
  old_version="$(jq -r '.old_version' <<<"$entry")"
  new_version="$(jq -r '.new_version' <<<"$entry")"
  subject_tools+=( "$tool $new_version" )

  # awk consumes the complete stream, avoiding a SIGPIPE failure under
  # `set -o pipefail` when a refresh changes more than forty files.
  file_notes="$(git diff --cached --name-status --no-renames HEAD -- "$dir" | awk 'NR <= 40')"
  [ -n "$file_notes" ] || { echo "$tool has no staged reviewed files." >&2; exit 1; }
  release_notes+=$'\n\n'"## $tool"$'\n'
  if [ "$old_version" = "$new_version" ]; then
    release_notes+="Refreshed model-facing surfaces for $new_version. Reviewed file changes:"$'\n\n```text\n'
  else
    release_notes+="Updated the normalized archive from $old_version to $new_version. Reviewed file changes:"$'\n\n```text\n'
  fi
  release_notes+="$file_notes"$'\n```'
done < <(jq -c '.[]' "$changed_file")

subject="Refresh ${subject_tools[*]}"
if [ "${#subject}" -gt 72 ]; then subject="Automated normalized capture refresh"; fi
git commit -m "$subject" -m "$release_notes"

today="$(date -u +%Y.%m.%d)"
tag="$today"
suffix=2
while git rev-parse "$tag" >/dev/null 2>&1 || git ls-remote --tags origin "refs/tags/$tag" | grep -q .; do
  tag="${today}-${suffix}"
  suffix=$((suffix + 1))
done

git tag -a "$tag" \
  -m "Automated capture refresh $today" \
  -m "$release_notes"

branch="$(git rev-parse --abbrev-ref HEAD)"
git push --atomic origin "$branch" "$tag"

gh release create "$tag" \
  --repo "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}" \
  --title "$tag" \
  --notes "$release_notes"

echo "Released $tag with ${#dirs[@]} reviewed tool refresh(es)."
