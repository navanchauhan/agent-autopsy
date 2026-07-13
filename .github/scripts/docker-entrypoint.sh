#!/bin/bash
# Fix bind-mount ownership, then run capture tools as the unprivileged user.

set -euo pipefail

if [ -d /workspace ]; then
  chown -R runner:runner /workspace
fi

export HOME=/home/runner
export PATH="/home/runner/.local/bin:/home/runner/.grok/bin:/home/runner/.npm-global/bin:${PATH}"

exec gosu runner env HOME="$HOME" PATH="$PATH" "$@"
