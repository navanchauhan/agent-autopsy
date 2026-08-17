#!/usr/bin/env bash
# Zero-token boundary test executed inside Codex's own shell sandbox.

set -euo pipefail

profile="${1:?profile is required}"
tool_dir="${2:?tool directory is required}"
case "$tool_dir" in
  codex|claude-code|grok|antigravity|qwen-code) ;;
  *) echo "Unsupported smoke-test tool directory: $tool_dir" >&2; exit 2 ;;
esac

test -z "${UNAPPROVED_SENTINEL:-}"
if cat "$HOME/.codex/auth.json" >/dev/null 2>&1; then
  echo "Sandbox could read Codex auth.json" >&2
  exit 1
fi
if cat /credential-state/codex-auth.json >/dev/null 2>&1; then
  echo "Sandbox could read the credential-state mount" >&2
  exit 1
fi
alias_path="$CODEX_WORK_DIR/.auth-alias"
if ln -s "$HOME/.codex/auth.json" "$alias_path" >/dev/null 2>&1; then
  if cat "$alias_path" >/dev/null 2>&1; then
    echo "Sandbox could read Codex auth.json through a symlink alias" >&2
    exit 1
  fi
  rm -f -- "$alias_path"
fi
if cat "/proc/self/root${HOME}/.codex/auth.json" >/dev/null 2>&1 ||
   cat /proc/self/root/credential-state/codex-auth.json >/dev/null 2>&1; then
  echo "Sandbox could read a credential through a procfs root alias" >&2
  exit 1
fi
if tr '\0' '\n' </proc/self/environ 2>/dev/null | grep -Fq UNAPPROVED_SENTINEL; then
  echo "Sandbox could inspect the denied process environment" >&2
  exit 1
fi

case "$profile" in
  author)
    touch "$CODEX_WORK_DIR/.author-write"
    touch "$REPO_ROOT/$tool_dir/.author-write"
    if touch "$REPO_ROOT/.root-write" >/dev/null 2>&1; then
      rm -f "$REPO_ROOT/.root-write"
      echo "Author sandbox could write the repository root" >&2
      exit 1
    fi
    ;;
  review)
    test -r "$CHANGED_TOOLS_FILE"
    if touch "$REPO_ROOT/$tool_dir/.review-write" >/dev/null 2>&1; then
      rm -f "$REPO_ROOT/$tool_dir/.review-write"
      echo "Reviewer sandbox could write a tool directory" >&2
      exit 1
    fi
    if touch "$REPO_ROOT/.review-root-write" >/dev/null 2>&1; then
      rm -f "$REPO_ROOT/.review-root-write"
      echo "Reviewer sandbox could write the repository root" >&2
      exit 1
    fi
    ;;
  *) echo "Profile must be author or review" >&2; exit 2 ;;
esac
