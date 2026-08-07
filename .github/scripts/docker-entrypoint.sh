#!/bin/bash
# Match the host runner identity, then run capture tools as that unprivileged
# user. Never recursively change ownership of the repository bind mount.

set -euo pipefail

if [[ "${HOST_UID:-}" =~ ^[0-9]+$ ]] && [[ "${HOST_GID:-}" =~ ^[0-9]+$ ]]; then
  groupmod -o -g "$HOST_GID" runner
  usermod -o -u "$HOST_UID" -g "$HOST_GID" runner
  chown -R runner:runner /home/runner
fi

export HOME=/home/runner
export PATH="/home/runner/.local/bin:/home/runner/.grok/bin:/home/runner/.npm-global/bin:${PATH}"

exec gosu runner env HOME="$HOME" PATH="$PATH" "$@"
