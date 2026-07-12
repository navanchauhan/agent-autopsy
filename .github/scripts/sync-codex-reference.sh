#!/usr/bin/env bash
# Codex's captures come from reading OpenAI's own open-source codex-rs tree
# (see codex/README.md), not from a live capture of the installed CLI. That
# reference clone (codex/VERSION's `reference_path = references/codex`) is
# deliberately NOT committed to this repo (it's a full foreign git history) and
# is even globally gitignored on the machine this was first captured on — so a
# fresh CI checkout starts with no references/codex at all. This script makes
# sure it exists and is current before run-codex-refresh.sh's orchestrator
# tries to read from it.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ref_dir="$repo_root/references/codex"

if [ -d "$ref_dir/.git" ]; then
  git -C "$ref_dir" fetch --quiet origin
  default_branch="$(git -C "$ref_dir" remote show origin | awk '/HEAD branch/ {print $NF}')"
  git -C "$ref_dir" reset --quiet --hard "origin/$default_branch"
else
  mkdir -p "$repo_root/references"
  git clone --quiet https://github.com/openai/codex.git "$ref_dir"
fi

echo "references/codex is at $(git -C "$ref_dir" rev-parse HEAD)"
